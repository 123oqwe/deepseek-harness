import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { seatbeltProfileArgs } from '../src/profiles.ts'

/**
 * Keyless backend integration through `confine()` and a real macOS Seatbelt process, with Linux
 * rungs forced off. Tests assert world effects and that the kernel denial matches the advertised
 * dialect; consumer coverage lives in dsh-bash-sandbox. Skips off macOS or when the profile probe
 * fails. HOME-based workspaces avoid Seatbelt's wholesale temp-directory grants, so
 * workspace-write proves the workspace-root grant itself.
 */

const probe = spawnSync('sandbox-exec', [...seatbeltProfileArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', 'true'], { timeout: 5_000, stdio: 'ignore' })
const seatbeltUsable = probe.status === 0

/** A Node program that connects to the Unix socket named by its argument and prints `connected` or the error code. */
const CONNECT = 'const s=require("net").connect(process.argv[1]);'
  + 's.on("connect",()=>{console.log("connected");process.exit(0)});s.on("error",e=>{console.log(e.code);process.exit(0)})'

let ctx: Context | undefined
const tempDirs: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(base: string): Promise<string> {
  const dir = await mkdtemp(join(base, 'dsh-seatbelt-e2e-'))
  tempDirs.push(dir)
  return dir
}

async function provider(): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { probeBwrap: () => false, probeLandlock: () => 'unusable' }
  return sandbox
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's facts. */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  const confined = sandbox.confine(['bash', '-c', command], policy)
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
  return { result, confined }
}

describe.skipIf(!seatbeltUsable)('sandbox-local: real Seatbelt confinement through sandbox-exec', () => {
  it('read-only denies a write — the file must NOT exist, and the kernel speaks the advertised dialect', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result, confined } = runConfined(sandbox, `echo hi > ${workdir}/denied.txt`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(confined.backend).toBe('seatbelt')
    expect(confined.enforcement).toBe('full')
    // The wrap's denialSignatures must be what the kernel actually prints.
    expect(result.stderr.toLowerCase()).toContain('operation not permitted')
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it.each(['absolute', 'relative'] as const)(
    'refuses a connection to a Unix-domain socket named by an %s path, while the same socket accepts an unconfined client',
    async (spelling) => {
      // A short directory: a socket path must stay under the ~104-byte limit, which HOME-based temp dirs can exceed.
      const dir = await tempDir('/tmp')
      const socket = join(dir, 's.sock')
      const server = createServer(connection => connection.end())
      servers.push(server)
      await new Promise<void>((resolve) => { server.listen(socket, resolve) })
      const named = spelling === 'absolute' ? socket : 's.sock'
      const unconfined = spawnSync(process.execPath, ['-e', CONNECT, named], { cwd: dir, timeout: 30_000, encoding: 'utf8' })
      expect(unconfined.stdout).toBe('connected\n')
      const sandbox = await provider()
      const { result, confined } = runConfined(sandbox, `cd "${dir}" && "${process.execPath}" -e '${CONNECT}' "${named}"`, { mode: 'read-only', workspaceRoot: dir })
      expect(confined.reachableSockets).toEqual([])
      expect(result.stdout).toBe('EPERM\n')
    },
  )

  it('keeps host-name resolution through mDNSResponder, the one socket daemon the profile allows', async () => {
    const sandbox = await provider()
    const lookup = 'require("dns").lookup("localhost",(e,a)=>{console.log(e?("ERR "+e.code):"resolved");process.exit(0)})'
    const { result } = runConfined(sandbox, `"${process.execPath}" -e '${lookup}'`, { mode: 'read-only', workspaceRoot: await tempDir(homedir()) })
    expect(result.stdout).toBe('resolved\n')
  })

  it('read-only keeps the tree readable/executable and /dev/null writable', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, 'ls / > /dev/null && echo dev-ok', { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('dev-ok\n')
  })

  it('read-only grants no temp area: a write under the user temp dir is denied too', async () => {
    // The per-user darwin temp dir is a workspace-write grant, not a
    // read-only one — under read-only the only write-shaped path is /dev/null.
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const target = join(workdir, 'tmp-denied.txt')
    const { result } = runConfined(sandbox, `echo hi > ${target}`, { mode: 'read-only', workspaceRoot: await tempDir(homedir()) })
    expect(result.status).not.toBe(0)
    expect(existsSync(target)).toBe(false)
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    const workdir = await tempDir(homedir())
    const outside = await tempDir(homedir())
    const sandbox = await provider()

    const inside = runConfined(sandbox, `printf seatbelt-ok > ${workdir}/allowed.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('seatbelt-ok')

    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('workspace-write grants /tmp and the user temp dir (the documented Seatbelt-profile temp areas)', async () => {
    const workdir = await tempDir(homedir())
    const hostTmp = await tempDir('/tmp')
    const userTmp = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(
      sandbox,
      `printf tmp-ok > ${hostTmp}/scratch.txt && printf user-tmp-ok > ${userTmp}/scratch.txt`,
      { mode: 'workspace-write', workspaceRoot: workdir },
    )
    expect(result.status).toBe(0)
    expect(readFileSync(join(hostTmp, 'scratch.txt'), 'utf8')).toBe('tmp-ok')
    expect(readFileSync(join(userTmp, 'scratch.txt'), 'utf8')).toBe('user-tmp-ok')
  })
})
