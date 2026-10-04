/**
 * Consumer-side `SandboxPwshExecutor` tests. A fake Cordis sandbox service
 * makes wrapping, policy hand-off, fail-closed propagation, and fact stamping
 * deterministic; real-provider integration lives in `tests/acl.e2e.ts`.
 * Requires pwsh for the integration block (skips without it — same gate as
 * pwsh-local's suites); the helpers block is pure and always runs. On POSIX a
 * run goes through the launch marker's wrappers, so a fake runner that exits
 * without starting the command is a runner failure; Windows has no marker and
 * counts only spawn failures. `$DSH_HOME` points at a temp directory.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SandboxProvider, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxExecutionPolicy, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPwshExecutor } from '../src/index.ts'
import { backendFacts, isRunnerSpawnFailure, matchesSignature, runnerFailureDetail } from '../src/helpers.ts'

// The same probe pwsh-local's suites and the vitest coverage exemption use:
// spawnSync never throws on a missing binary (it reports status null), and
// `where.exe pwsh` exits 1 when pwsh is absent — only the status is truth.
function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
}

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-spec-'))
const dshHome = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-home-'))

beforeAll(() => {
  vi.stubEnv('DSH_HOME', dshHome)
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(dshHome, { recursive: true, force: true })
})

/** Where the launch marker exists: everywhere but Windows. */
const MARKED = process.platform !== 'win32'

/** The program a run spawns first: the launch marker's host-side shell on POSIX, the runner itself on Windows. */
function spawnedProgram(runner: string): string {
  return MARKED ? '/bin/sh' : runner
}

/** One recorded provider call: the argv handed over and the policy it rode with. */
interface ConfineCall {
  argv: string[]
  policy: SandboxPolicy
}

/** A passthrough wrap: the caller's argv unchanged, asserted full — commands run unconfined, deterministically. */
const passthrough = (argv: readonly string[]): ConfinedArgv =>
  ({ argv: [...argv], backend: 'fake-runner', enforcement: 'full', reachableSockets: [], denialSignatures: ['access is denied', 'access to the path'] })

/** A subprocess service whose spawn() throws SYNCHRONOUSLY — the paths the async service never produces. */
function throwingSubprocessRuntime(error: unknown): new (ctx: Context) => Service {
  return class extends Service {
    constructor(ctx: Context) {
      super(ctx, 'subprocess')
    }

    spawn(): never {
      throw error
    }
  }
}

async function setup(
  behavior: (argv: readonly string[], policy: SandboxPolicy) => ConfinedArgv = passthrough,
  subprocess: new (ctx: Context) => Service = LocalSubprocessRuntime,
): Promise<{ executor: SandboxPwshExecutor; calls: ConfineCall[] }> {
  const calls: ConfineCall[] = []
  class FakeSandboxProvider extends SandboxProvider {
    confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
      calls.push({ argv: [...argv], policy })
      return behavior(argv, policy)
    }
  }
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: spillDir })
  await ctx.plugin(subprocess)
  if (ctx.subprocess instanceof LocalSubprocessRuntime) {
    ctx.subprocess.internals = { spillDir }
  }
  await ctx.plugin(SandboxPwshExecutor, { graceMs: 200 })
  return { executor: ctx.shell as SandboxPwshExecutor, calls }
}

describe('helpers (pure)', () => {
  const workdir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-helpers-'))
  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true })
  })

  describe('backendFacts', () => {
    it('names the backend and lists reachable sockets only when there are any', () => {
      expect(backendFacts({ backend: 'windows-acl', reachableSockets: [] })).toEqual({ backend: 'windows-acl' })
      expect(backendFacts({ backend: 'landlock', reachableSockets: ['/run/docker.sock'] }))
        .toEqual({ backend: 'landlock', reachableSockets: ['/run/docker.sock'] })
    })
  })

  describe('isRunnerSpawnFailure', () => {
    const absolute = process.execPath
    const bare = 'node'
    const relative = './sandbox-runner'

    it('attributes ENOENT/EACCES with argv[0] provenance and a usable workdir', () => {
      for (const runnerProgram of [absolute, bare, relative]) {
        expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: `spawn ${runnerProgram}`, path: runnerProgram }, runnerProgram, workdir)).toBe(true)
        expect(isRunnerSpawnFailure({ code: 'EACCES', syscall: `spawn ${runnerProgram}`, path: runnerProgram }, runnerProgram, workdir)).toBe(true)
        expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: runnerProgram }, runnerProgram, workdir)).toBe(true)
        expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: `spawn ${runnerProgram}` }, runnerProgram, workdir)).toBe(true)
      }
    })

    it('rejects mismatched provenance, foreign codes, unusable workdirs, and non-object errors', () => {
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: 'other' }, 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn other', path: 'node' }, 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'EMFILE', syscall: 'spawn', path: 'node' }, 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', path: 'node' }, 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn' }, 'node', join(workdir, 'missing'))).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn' }, undefined, workdir)).toBe(false)
      expect(isRunnerSpawnFailure('boom', 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure(null, 'node', workdir)).toBe(false)
      // An existing FILE (not a directory) workdir is unusable without throwing.
      const fileWorkdir = join(workdir, 'a-file')
      writeFileSync(fileWorkdir, 'x')
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: 'node' }, 'node', fileWorkdir)).toBe(false)
    })
  })

  describe('runnerFailureDetail', () => {
    it('names the runner\'s exit and its last non-empty stderr line', () => {
      expect(runnerFailureDetail(127, 'fake-runner: partial enforcement\nfake-runner: profile refused\n'))
        .toBe('the runner exited 127 before starting the command: fake-runner: profile refused')
      expect(runnerFailureDetail(1, '')).toBe('the runner exited 1 before starting the command')
    })
  })

  describe('matchesSignature', () => {
    it('matches non-zero exits case-insensitively, never zero or signal exits', () => {
      expect(matchesSignature(1, 'Access to the path is denied.', ['access to the path'])).toBe(true)
      expect(matchesSignature(1, 'ACCESS IS DENIED.', ['access is denied'])).toBe(true)
      expect(matchesSignature(1, 'clean', ['access is denied'])).toBe(false)
      expect(matchesSignature(0, 'access is denied', ['access is denied'])).toBe(false)
      expect(matchesSignature(null, 'access is denied', ['access is denied'])).toBe(false)
    })
  })
})

describe.skipIf(!pwshAvailable())('SandboxPwshExecutor', () => {
  // Denial device for the POSIX classification cases: a mode-0555 directory
  // INSIDE a temp scratch tree (the same device as bash-sandbox's suites) —
  // unit tests never attempt writes outside the system temp directory. On
  // win32 there is no POSIX mode denial; the real-sandbox denial coverage
  // lives in tests/acl.e2e.ts, where the ACL runner denies scratch paths.
  const readOnlyDir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-ro-'))
  if (process.platform !== 'win32') chmodSync(readOnlyDir, 0o555)
  const deniedWriteCommand = `[IO.File]::WriteAllText('${join(readOnlyDir, 'probe.txt')}', 'x')`

  afterAll(() => {
    if (process.platform !== 'win32') chmodSync(readOnlyDir, 0o755)
    rmSync(readOnlyDir, { recursive: true, force: true })
    rmSync(spillDir, { recursive: true, force: true })
  })

  const RO: SandboxExecutionPolicy = { mode: 'read-only', workspaceRoot: '/ws' }

  it('wraps the exact pwsh argv through ctx.sandbox with the per-call policy', async () => {
    const { executor, calls } = await setup()
    const result = await executor.run(executor.resolve({ command: 'echo wrapped', sandboxPolicy: RO }))
    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.policy).toEqual(RO)
    // The confined argv is the pwsh invocation, behind the launch marker's
    // in-sandbox wrapper on POSIX, ready for a runner prefix.
    if (MARKED) expect(call?.argv.slice(0, 4)).toEqual(['/bin/sh', '-c', expect.stringContaining('>&9'), 'dsh-launched'])
    expect(call?.argv[MARKED ? 4 : 0]).toMatch(/pwsh(\.exe)?$/u)
    expect(call?.argv).toContain('-NonInteractive')
    expect(call?.argv.at(-1)).toContain('echo wrapped')
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full', backend: 'fake-runner' })
  }, 30_000)

  it('advertises the deployment default mode and stamps the deployment policy when none rides the request', async () => {
    const { executor, calls } = await setup()
    expect(executor.sandboxMode).toBe('workspace-write')
    const result = await executor.run(executor.resolve({ command: 'echo fallback' }))
    expect(result.exitCode).toBe(0)
    expect(calls[0]?.policy.mode).toBe('workspace-write')
  }, 30_000)

  it('danger-full-access bypasses confine entirely and stamps full-access facts', async () => {
    const { executor, calls } = await setup()
    const result = await executor.run(executor.resolve({ command: 'echo full', sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: '/ws' } }))
    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(0)
    expect(result.sandbox).toEqual({ mode: 'danger-full-access', denied: false })
  }, 30_000)

  it('an aborted caller signal outranks runner-spawn attribution', async () => {
    const controller = new AbortController()
    controller.abort('caller-cancel')
    const { executor } = await setup(() => ({
      argv: ['definitely-not-a-real-runner', '--', 'pwsh'],
      backend: 'fake-runner',
      enforcement: 'full',
      reachableSockets: [],
      denialSignatures: [],
    }))
    await expect(executor.run(executor.resolve({ command: 'echo never', sandboxPolicy: RO, signal: controller.signal })))
      .rejects.toThrow('caller-cancel')
  }, 30_000)

  // POSIX-only: the denial device is a mode-0555 scratch dir. On win32 the
  // real-sandbox denial classification is covered by tests/acl.e2e.ts
  // (the ACL runner denies scratch paths — unit tests never leave temp).
  it.skipIf(process.platform === 'win32')('classifies a failed write against the backend denial dialect', async () => {
    const { executor } = await setup()
    const result = await executor.run(executor.resolve({
      command: deniedWriteCommand,
      sandboxPolicy: RO,
    }))
    expect(result.exitCode).not.toBe(0)
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full', backend: 'fake-runner' })
  }, 30_000)

  it('a runner launch refusal fails closed with SANDBOX_UNAVAILABLE, never unconfined', async () => {
    const { executor } = await setup(() => ({
      argv: ['definitely-not-a-real-runner', '--', 'pwsh'],
      backend: 'fake-runner',
      enforcement: 'full',
      reachableSockets: [],
      denialSignatures: [],
    }))
    await expect(executor.run(executor.resolve({ command: 'echo never-runs', sandboxPolicy: RO })))
      .rejects.toThrow(SandboxUnavailableError)
  }, 30_000)

  it('a SYNCHRONOUS attributable spawn rejection in run() fails closed, an unattributable one rethrows', async () => {
    const program = spawnedProgram('node')
    const attributable = Object.assign(new Error('sync-enoent'), { code: 'ENOENT', syscall: `spawn ${program}`, path: program })
    const { executor: closed } = await setup(() => ({
      argv: ['node', '--', 'pwsh'],
      backend: 'fake-runner',
      enforcement: 'full',
      reachableSockets: [],
      denialSignatures: [],
    }), throwingSubprocessRuntime(attributable))
    await expect(closed.run(closed.resolve({ command: 'echo never', sandboxPolicy: RO })))
      .rejects.toThrow(SandboxUnavailableError)

    const foreign = Object.assign(new Error('sync-emfile'), { code: 'EMFILE', syscall: 'spawn', path: 'node' })
    const { executor: passthroughError } = await setup(undefined, throwingSubprocessRuntime(foreign))
    await expect(passthroughError.run(passthroughError.resolve({ command: 'echo never', sandboxPolicy: RO })))
      .rejects.toThrow('sync-emfile')
  }, 30_000)

  it('a SYNCHRONOUS spawn rejection in start() follows the same attribution split', async () => {
    const program = spawnedProgram('node')
    const attributable = Object.assign(new Error('sync-enoent-start'), { code: 'ENOENT', syscall: `spawn ${program}`, path: program })
    const { executor: closed } = await setup(() => ({
      argv: ['node', '--', 'pwsh'],
      backend: 'fake-runner',
      enforcement: 'full',
      reachableSockets: [],
      denialSignatures: [],
    }), throwingSubprocessRuntime(attributable))
    expect(() => closed.start(closed.resolve({ command: 'echo never', sandboxPolicy: RO })))
      .toThrow(SandboxUnavailableError)

    const foreign = Object.assign(new Error('sync-emfile-start'), { code: 'EMFILE', syscall: 'spawn', path: 'node' })
    const { executor: passthroughError } = await setup(undefined, throwingSubprocessRuntime(foreign))
    expect(() => passthroughError.start(passthroughError.resolve({ command: 'echo never', sandboxPolicy: RO })))
      .toThrow('sync-emfile-start')
  }, 30_000)

  it('a runner that exits before starting the command fails closed where the launch marker exists; on Windows only a spawn failure counts', async () => {
    const { executor } = await setup(() => ({
      argv: [process.execPath, '-e', 'console.error(\'fake-runner: profile refused\'); process.exit(127)', '--'],
      backend: 'fake-runner',
      enforcement: 'full',
      reachableSockets: [],
      denialSignatures: [],
    }))
    const run = executor.run(executor.resolve({ command: 'echo never-runs', sandboxPolicy: RO }))
    if (MARKED) await expect(run).rejects.toThrow(SandboxUnavailableError)
    else await expect(run).resolves.toMatchObject({ exitCode: 127, sandbox: { mode: 'read-only', denied: false, enforcement: 'full', backend: 'fake-runner' } })
  }, 30_000)

  it('a command that prints a runner\'s failure text and exits with its code is an ordinary result', async () => {
    const { executor } = await setup()
    const command = "[Console]::Error.WriteLine('windows-acl-run: missing --workspace'); exit 127"
    const result = await executor.run(executor.resolve({ command, sandboxPolicy: RO }))
    expect([result.exitCode, result.sandbox]).toEqual([127, { mode: 'read-only', denied: false, enforcement: 'full', backend: 'fake-runner' }])
    const proc = executor.start(executor.resolve({ command, sandboxPolicy: RO }))
    await proc.done
    expect(proc.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full', backend: 'fake-runner' })
  }, 30_000)

  it('background confined runs stamp clean facts at settlement', async () => {
    const { executor } = await setup()
    const clean = executor.start(executor.resolve({ command: 'echo background-ok', sandboxPolicy: RO }))
    await clean.done
    expect(clean.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full', backend: 'fake-runner' })
  }, 30_000)

  // POSIX-only denial device (mode-0555 scratch); win32 real-sandbox denial
  // coverage lives in tests/acl.e2e.ts.
  it.skipIf(process.platform === 'win32')('background denied writes stamp denied facts at settlement', async () => {
    const { executor } = await setup()
    const denied = executor.start(executor.resolve({
      command: deniedWriteCommand,
      sandboxPolicy: RO,
    }))
    await denied.done
    expect(denied.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full', backend: 'fake-runner' })
  }, 30_000)

  it('a background runner that cannot start settles as runnerFailed facts', async () => {
    const { executor } = await setup(() => ({
      argv: ['definitely-not-a-real-runner', '--', 'pwsh'],
      backend: 'fake-runner',
      enforcement: 'full',
      reachableSockets: [],
      denialSignatures: [],
    }))
    const proc = executor.start(executor.resolve({ command: 'echo never', sandboxPolicy: RO }))
    await proc.done
    expect(proc.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full', backend: 'fake-runner', runnerFailed: true })
    // The failure surfaces through the read path: the host-side shell's exec
    // error on POSIX, the spawn rejection note on Windows.
    const read = proc.readOutput()
    expect(read.delta).toContain(MARKED ? 'definitely-not-a-real-runner' : 'subprocess failed before reporting an outcome')
  }, 30_000)

  // POSIX-only: the fake runners are /bin/sh scripts, and Windows has no launch marker.
  it.skipIf(!MARKED)('a runner stopped before it starts the command keeps its own outcome: a signal death, the deadline, an abort', async () => {
    const wrap = (script: string) => (argv: readonly string[]): ConfinedArgv => ({
      argv: ['/bin/sh', '-c', script, 'fake-runner', '--', ...argv],
      backend: 'fake-runner',
      enforcement: 'full',
      reachableSockets: [],
      denialSignatures: [],
    })
    const { executor: killed } = await setup(wrap('kill -9 $$'))
    const signalled = await killed.run(killed.resolve({ command: 'echo never', sandboxPolicy: RO }))
    expect([signalled.exitCode, signalled.signal]).toEqual([null, 'SIGKILL'])
    const proc = killed.start(killed.resolve({ command: 'echo never', sandboxPolicy: RO }))
    await proc.done
    expect(proc.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full', backend: 'fake-runner' })

    const { executor: stalling } = await setup(wrap('trap "exit 3" TERM; while :; do sleep 0.05; done'))
    const timedOut = await stalling.run(stalling.resolve({ command: 'echo never', sandboxPolicy: RO, timeoutMs: 300 }))
    expect([timedOut.timedOut, timedOut.exitCode]).toEqual([true, 3])
    const controller = new AbortController()
    setTimeout(() => { controller.abort() }, 300)
    const aborted = await stalling.run(stalling.resolve({ command: 'echo never', sandboxPolicy: RO, signal: controller.signal }))
    expect([aborted.aborted, aborted.exitCode]).toEqual([true, 3])
  }, 30_000)

  it('danger-full-access background runs bypass confine and carry no facts', async () => {
    const { executor, calls } = await setup()
    const proc = executor.start(executor.resolve({
      command: 'echo full-bg',
      sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: '/ws' },
    }))
    await proc.done
    expect(calls).toHaveLength(0)
    expect(proc.sandbox).toBeUndefined()
  }, 30_000)
})
