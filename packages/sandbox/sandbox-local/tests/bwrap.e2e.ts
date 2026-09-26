import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { bwrapProfileArgs } from '../src/profiles.ts'
import { seccompTrampoline, unixSocketFilter } from '../src/seccomp.ts'

/**
 * Keyless backend integration through `confine()` and a real bwrap process. With no rung forced,
 * a passing probe must select the first rung. Tests assert world effects, wrap shape, and that the
 * kernel denial matches the advertised dialect; consumer coverage lives in dsh-bash-sandbox.
 * Skips when bwrap, user namespaces, or the seccomp filter are unavailable, probing exactly as the
 * provider does. HOME-based workspaces avoid bwrap's ephemeral `/tmp`, so workspace-write actually
 * proves the workspace-root rebind, and a HOME-based socket stays visible through the read-only
 * root bind, so its refusal is the filter's and not the ephemeral `/tmp`'s.
 */

const filter = unixSocketFilter(process.arch)
const runner = ['bwrap', ...bwrapProfileArgs({ mode: 'read-only', workspaceRoot: '/' })]
const probeArgv = [...filter === undefined ? runner : seccompTrampoline(filter, [...runner, '--seccomp', '3']), '--', 'true']
const probe = spawnSync(probeArgv[0] as string, probeArgv.slice(1), { timeout: 5_000, stdio: 'ignore' })
const bwrapUsable = probe.status === 0

/** A Node program that connects to the Unix socket named by its argument and prints `connected` or the error code. */
const CONNECT = 'const s=require("net").connect(process.argv[1]);'
  + 's.on("connect",()=>{console.log("connected");process.exit(0)});s.on("error",e=>{console.log(e.code);process.exit(0)})'

let ctx: Context | undefined
const tempDirs: string[] = []
const tempFiles: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  for (const file of tempFiles.splice(0)) rmSync(file, { force: true })
})

/**
 * Listen on a Unix-domain socket in `dir`.
 * @param dir - a directory under the home directory.
 * @returns the socket's path.
 */
async function listeningSocket(dir: string): Promise<string> {
  const path = join(dir, 's.sock')
  const server = createServer()
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(path, resolve) })
  return path
}

async function tempDir(base: string): Promise<string> {
  const dir = await mkdtemp(join(base, 'dsh-bwrap-e2e-'))
  tempDirs.push(dir)
  return dir
}

async function provider(): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  return ctx.sandbox as LocalSandboxProvider
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's facts. */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  const confined = sandbox.confine(['bash', '-c', command], policy)
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
  return { result, confined }
}

describe.skipIf(!bwrapUsable)('sandbox-local: real bwrap confinement', () => {
  it('the passing probe selects the bwrap rung naturally — first in the ladder, full enforcement, EROFS dialect', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const confined = sandbox.confine(['true'], { mode: 'read-only', workspaceRoot: workdir })
    expect(confined.backend).toBe('bwrap')
    expect(confined.enforcement).toBe(filter === undefined ? 'partial' : 'full')
    expect(confined.denialSignatures).toEqual(['read-only file system'])
  })

  it.skipIf(filter === undefined).each(['read-only', 'workspace-write'] as const)(
    '%s refuses a Unix-domain socket: creating one fails with EPERM, while the same socket accepts an unconfined client',
    async (mode) => {
      const workdir = await tempDir(homedir())
      const socket = await listeningSocket(workdir)
      const unconfined = spawnSync(process.execPath, ['-e', CONNECT, socket], { timeout: 30_000, encoding: 'utf8' })
      expect(unconfined.stdout).toBe('connected\n')
      const sandbox = await provider()
      const { result, confined } = runConfined(sandbox, `"${process.execPath}" -e '${CONNECT}' "${socket}"`, { mode, workspaceRoot: workdir })
      expect(confined.reachableSockets).toEqual([])
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('EPERM\n')
    },
  )

  it.skipIf(filter === undefined)('keeps pipes, the socket pairs a child process is spawned over, and inet sockets working', async () => {
    const workdir = await tempDir(homedir())
    const sandbox = await provider()
    const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: workdir }
    const pipe = runConfined(sandbox, 'printf piped | cat', policy)
    expect(pipe.result.stdout).toBe('piped')
    // libuv spawns a child over socketpair(AF_UNIX), which the filter leaves allowed.
    const child = runConfined(sandbox, `"${process.execPath}" -e 'process.stdout.write(require("child_process").execFileSync("echo",["paired"]))'`, policy)
    expect(child.result.stdout).toBe('paired\n')
    const inet = runConfined(
      sandbox,
      `"${process.execPath}" -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log("inet");s.close()})'`,
      policy,
    )
    expect(inet.result.stdout).toBe('inet\n')
  })

  it('read-only denies a write — the file must NOT exist, and the kernel speaks the advertised dialect', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `echo hi > ${workdir}/denied.txt`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    // The wrap's denialSignatures must be what the kernel actually prints.
    expect(result.stderr.toLowerCase()).toContain('read-only file system')
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it('read-only keeps the tree readable/executable and the fresh /dev/null writable', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, 'ls / > /dev/null && echo dev-ok', { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('dev-ok\n')
  })

  it.each(['read-only', 'workspace-write'] as const)(
    '%s runs in a private PID namespace and blocks writes through procfs root magic links',
    async (mode) => {
      const workdir = await tempDir(homedir())
      const outside = await tempDir(homedir())
      const target = join(outside, 'escaped.txt')
      const sandbox = await provider()
      // Compare PID-namespace identity, not PID numbers: numeric /proc entries
      // recur inside a private namespace, and the /proc/1/root write below is
      // denied even in a shared namespace (host init is root-owned), so this
      // comparison is the assertion that fails when --unshare-pid is lost.
      const hostPidNamespace = readlinkSync('/proc/self/ns/pid')
      const visibility = runConfined(sandbox, 'readlink /proc/self/ns/pid', { mode, workspaceRoot: workdir })
      expect(visibility.result.status).toBe(0)
      expect(visibility.result.stdout.trim()).not.toBe('')
      expect(visibility.result.stdout.trim()).not.toBe(hostPidNamespace)

      const escape = runConfined(
        sandbox,
        `printf escaped > /proc/1/root${target}`,
        { mode, workspaceRoot: workdir },
      )
      expect(escape.result.status).not.toBe(0)
      expect(existsSync(target)).toBe(false)
    },
  )

  it('keeps descendants observable and controllable inside the private PID namespace', async () => {
    const workdir = await tempDir(homedir())
    const sandbox = await provider()
    const { result } = runConfined(
      sandbox,
      'sleep 30 & child=$!; kill -0 "$child" && kill "$child"; wait "$child"; status=$?; test "$status" -ge 128',
      { mode: 'read-only', workspaceRoot: workdir },
    )
    expect(result.status).toBe(0)
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    const workdir = await tempDir(homedir())
    const outside = await tempDir(homedir())
    const sandbox = await provider()

    const inside = runConfined(sandbox, `printf bwrap-ok > ${workdir}/allowed.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('bwrap-ok')

    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('workspace-write mounts an EPHEMERAL /tmp: the write succeeds inside, the host /tmp stays untouched', async () => {
    // The documented bwrap-profile difference: Landlock and Seatbelt grant
    // the HOST temp areas, bwrap swaps in a fresh tmpfs that dies with the
    // process — the strongest of the three temp semantics.
    const workdir = await tempDir(homedir())
    const target = `/tmp/dsh-bwrap-e2e-ephemeral-${process.pid}.txt`
    tempFiles.push(target)
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `printf tmp-ok > ${target} && cat ${target}`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('tmp-ok')
    expect(existsSync(target)).toBe(false)
  })
})
