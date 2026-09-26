/**
 * The search for the host's known daemon and agent sockets, against real
 * Unix-domain sockets in fresh directories. The host running the tests may
 * have sockets of its own at the fixed locations, so each case asserts what it
 * placed and what it excluded rather than the whole list.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { knownHostSockets } from '../src/sockets.ts'

const servers: Server[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A fresh directory with a short path: a socket path must stay under the
 * platform's ~104-byte limit.
 * @returns the directory.
 */
function freshRoot(): string {
  const root = mkdtempSync('/tmp/dsh-s-')
  roots.push(root)
  return root
}

/**
 * Listen on a Unix-domain socket, creating its directory first.
 * @param path - where the socket lives.
 * @returns the same path.
 */
async function socketAt(path: string): Promise<string> {
  mkdirSync(dirname(path), { recursive: true })
  const server = createServer()
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(path, resolve) })
  return path
}

/**
 * Write a JSON file, creating its directory first.
 * @param path - the file.
 * @param text - its content.
 */
function fileAt(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

describe('knownHostSockets', () => {
  it('names $SSH_AUTH_SOCK and a unix:// $DOCKER_HOST when they are sockets', async () => {
    const root = freshRoot()
    const agent = await socketAt(join(root, 'agent.sock'))
    const daemon = await socketAt(join(root, 'docker.sock'))
    const found = knownHostSockets({ env: { SSH_AUTH_SOCK: agent, DOCKER_HOST: `unix://${daemon}` }, home: root })
    expect(found).toContain(agent)
    expect(found).toContain(daemon)
  })

  it('ignores a tcp endpoint, a regular file, a missing path and an empty variable', async () => {
    const root = freshRoot()
    fileAt(join(root, 'not-a-socket'), 'plain')
    const found = knownHostSockets({
      env: { SSH_AUTH_SOCK: join(root, 'not-a-socket'), DOCKER_HOST: 'tcp://127.0.0.1:2375', XDG_RUNTIME_DIR: '' },
      home: root,
    })
    expect(found).not.toContain(join(root, 'not-a-socket'))
    expect(found.filter(path => path.startsWith(root))).toEqual([])
  })

  it('names the daemon socket the Docker CLI\'s current context points at, $DOCKER_CONTEXT first', async () => {
    const root = freshRoot()
    const config = join(root, 'cfg')
    const colima = await socketAt(join(root, 'colima.sock'))
    const other = await socketAt(join(root, 'other.sock'))
    const meta = (name: string, host: unknown): void => {
      fileAt(
        join(config, 'contexts', 'meta', createHash('sha256').update(name).digest('hex'), 'meta.json'),
        JSON.stringify({ Endpoints: { docker: { Host: host } } }),
      )
    }
    fileAt(join(config, 'config.json'), JSON.stringify({ currentContext: 'colima' }))
    meta('colima', `unix://${colima}`)
    meta('other', `unix://${other}`)
    expect(knownHostSockets({ env: { DOCKER_CONFIG: config }, home: root })).toContain(colima)
    const overridden = knownHostSockets({ env: { DOCKER_CONFIG: config, DOCKER_CONTEXT: 'other' }, home: root })
    expect(overridden).toContain(other)
    expect(overridden).not.toContain(colima)
  })

  it('reads the Docker configuration under the home directory when $DOCKER_CONFIG is unset', async () => {
    const root = freshRoot()
    const daemon = await socketAt(join(root, 'd.sock'))
    fileAt(join(root, '.docker', 'config.json'), JSON.stringify({ currentContext: 'desk' }))
    fileAt(
      join(root, '.docker', 'contexts', 'meta', createHash('sha256').update('desk').digest('hex'), 'meta.json'),
      JSON.stringify({ Endpoints: { docker: { Host: `unix://${daemon}` } } }),
    )
    expect(knownHostSockets({ env: {}, home: root })).toContain(daemon)
  })

  it('names nothing for the default context, a context without a unix endpoint, or a file that is not JSON', async () => {
    const root = freshRoot()
    const configs = {
      default: { config: JSON.stringify({ currentContext: 'default' }) },
      tcp: { config: JSON.stringify({ currentContext: 'tcp' }), host: 'tcp://10.0.0.1:2376' },
      numeric: { config: JSON.stringify({ currentContext: 'numeric' }), host: 42 },
      broken: { config: '{ not json' },
      nameless: { config: JSON.stringify({ currentContext: 7 }) },
    }
    for (const [name, { config, ...rest }] of Object.entries(configs)) {
      const dir = join(root, name)
      fileAt(join(dir, 'config.json'), config)
      if ('host' in rest) {
        const metaPath = join(dir, 'contexts', 'meta', createHash('sha256').update(name).digest('hex'), 'meta.json')
        fileAt(metaPath, JSON.stringify({ Endpoints: { docker: { Host: rest.host } } }))
      }
      expect(knownHostSockets({ env: { DOCKER_CONFIG: dir }, home: root }).filter(path => path.startsWith(root))).toEqual([])
    }
  })

  it('names the fixed locations under $XDG_RUNTIME_DIR and the home directory', async () => {
    const root = freshRoot()
    const runtime = join(root, 'run')
    const rootless = await socketAt(join(runtime, 'docker.sock'))
    const podman = await socketAt(join(runtime, 'podman', 'podman.sock'))
    const desktop = await socketAt(join(root, '.docker', 'run', 'docker.sock'))
    const found = knownHostSockets({ env: { XDG_RUNTIME_DIR: runtime }, home: root })
    expect(found).toContain(rootless)
    expect(found).toContain(podman)
    expect(found).toContain(desktop)
  })

  it('names OpenSSH\'s default agent sockets and the launchd listener under $TMPDIR, and nothing else there', async () => {
    const root = freshRoot()
    const agent = await socketAt(join(root, 'ssh-XXa1b2', 'agent.4242'))
    const launchd = await socketAt(join(root, 'com.apple.launchd.Q7', 'Listeners'))
    await socketAt(join(root, 'ssh-XXa1b2', 'other.sock'))
    await socketAt(join(root, 'elsewhere', 'agent.1'))
    const found = knownHostSockets({ env: { TMPDIR: root }, home: root }).filter(path => path.startsWith(root))
    expect(found.sort()).toEqual([agent, launchd].sort())
  })

  it('reads nothing from a temp root that cannot be listed', () => {
    const found = knownHostSockets({ env: { TMPDIR: '/nonexistent-dsh-tmp' }, home: '/nonexistent-dsh-home' })
    expect(found.filter(path => path.startsWith('/nonexistent-dsh'))).toEqual([])
  })

  it('names a socket reached through a link by the link\'s path, ignores a dangling link, and names each path once', async () => {
    const root = freshRoot()
    const real = await socketAt(join(root, 'real.sock'))
    const link = join(root, 'link.sock')
    symlinkSync(real, link)
    const dangling = join(root, 'dangling.sock')
    symlinkSync(join(root, 'gone.sock'), dangling)
    const found = knownHostSockets({ env: { SSH_AUTH_SOCK: link, DOCKER_HOST: `unix://${link}`, TMPDIR: dangling }, home: root })
    expect(found.filter(path => path === link)).toEqual([link])
    expect(found).not.toContain(real)
    expect(found).not.toContain(dangling)
  })
})
