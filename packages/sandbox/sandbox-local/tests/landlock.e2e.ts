import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { launcherPath } from '@deepseek-ai/node-addon-system/landlock-run'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'

/**
 * Keyless backend integration through `confine()` and the workspace `landlock-run` launcher, with
 * bwrap forced off. Tests assert real world effects; consumer coverage lives in dsh-bash-sandbox.
 * Skips when the platform package or enforcing kernel is unavailable. HOME-based workspaces avoid
 * Landlock's wholesale `/tmp` grant, so workspace-write proves the workspace-root grant itself.
 * Every wrap is `partial`: Landlock cannot refuse Unix-domain sockets, whatever its ABI.
 */

const probe = spawnSync(launcherPath(), ['--probe'], { timeout: 5_000, encoding: 'utf8' })
const landlockUsable = probe.status === 0

let ctx: Context | undefined
const tempDirs: string[] = []
const servers: Server[] = []
/** The operator warnings the provider under test wrote. */
let warnings: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  warnings = []
})

async function tempDir(base: string): Promise<string> {
  const dir = await mkdtemp(join(base, 'dsh-landlock-e2e-'))
  tempDirs.push(dir)
  return dir
}

async function provider(hostSockets: () => string[] = () => []): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { probeBwrap: () => false, hostSockets, writeWarning: (line) => { warnings.push(line) } }
  return sandbox
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's enforcement. */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  const confined = sandbox.confine(['bash', '-c', command], policy)
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
  return { result, enforcement: confined.enforcement }
}

describe.skipIf(!landlockUsable)('sandbox-local: real Landlock confinement through the bundled launcher', () => {
  it('read-only denies a write — the file must NOT exist, the wrap is partial', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result, enforcement: wrapped } = runConfined(sandbox, `echo hi > ${workdir}/denied.txt`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(wrapped).toBe('partial')
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it('leaves a known Unix socket reachable, names it in the wrap, and warns the operator', async () => {
    const workdir = await tempDir(homedir())
    const socket = join(workdir, 's.sock')
    const server = createServer(connection => connection.end())
    servers.push(server)
    await new Promise<void>((resolve) => { server.listen(socket, resolve) })
    const sandbox = await provider(() => [socket])
    const connect = 'const s=require("net").connect(process.argv[1]);'
      + 's.on("connect",()=>{console.log("connected");process.exit(0)});s.on("error",e=>{console.log(e.code);process.exit(0)})'
    const confined = sandbox.confine(['bash', '-c', `"${process.execPath}" -e '${connect}' "${socket}"`], { mode: 'workspace-write', workspaceRoot: workdir })
    expect(confined.reachableSockets).toEqual([socket])
    expect(confined.enforcement).toBe('partial')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(socket)
    const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
    expect(result.stdout).toBe('connected\n')
  })

  it('read-only keeps the tree readable/executable and /dev/null writable', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, 'ls / > /dev/null && echo dev-ok', { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('dev-ok\n')
  })

  it('read-only denies a write beneath the host /dev (the /dev/shm tmpfs must stay untouched)', async () => {
    // The grant is /dev/null the FILE, not /dev the directory: /dev/shm is a
    // world-writable host tmpfs, and a write landing there would be exactly
    // the persistent host effect read-only promises never happen.
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const target = `/dev/shm/dsh-landlock-e2e-${process.pid}`
    const { result } = runConfined(sandbox, `echo hi > ${target}`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(existsSync(target)).toBe(false)
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    const workdir = await tempDir(homedir())
    const outside = await tempDir(homedir())
    const sandbox = await provider()

    const inside = runConfined(sandbox, `printf landlock-ok > ${workdir}/allowed.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('landlock-ok')

    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('workspace-write grants the host /tmp (the documented Landlock-profile difference)', async () => {
    const workdir = await tempDir(homedir())
    const scratch = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `printf tmp-ok > ${scratch}/scratch.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(readFileSync(join(scratch, 'scratch.txt'), 'utf8')).toBe('tmp-ok')
  })
})
