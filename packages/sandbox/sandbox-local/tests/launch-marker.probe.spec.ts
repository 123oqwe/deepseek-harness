/**
 * PROBE — never merge. Epic P3-03 U2 (delegate rulings Q-U2a and Q-U2c): before
 * the build, measure on the narrow runner whether a launch marker works under
 * each Linux backend. A host-side `/bin/sh` opens a status file on descriptor 9
 * and execs the runner; a `/bin/sh` inside the sandbox writes `launched` to
 * descriptor 9, closes it, and execs the command. The status file lives in a
 * directory under the home directory that is no writable root of the policy.
 * Seatbelt is not reachable from the narrow runner.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'

/** The host-side wrapper: open the status file on descriptor 9, then exec the runner. */
const OUTER = 'exec 9>"$1" || exit 126; shift; exec "$@"'
/** The wrapper inside the sandbox: write the marker, close descriptor 9, then exec the command. */
const INNER = 'printf launched >&9 && exec 9>&- && exec "$@"'

type Backend = 'bwrap' | 'landlock'

/** One marked run. */
interface MarkedRun {
  readonly exit: number | null
  readonly stderr: string
  /** The status file's content after the run. */
  readonly marker: string
}

let ctx: Context | undefined
const tempDirs: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * A fresh directory under the home directory, outside the temp directories a policy makes writable.
 * @returns its path.
 */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(homedir(), 'dsh-u2-probe-'))
  tempDirs.push(dir)
  return dir
}

/**
 * The local provider with the Linux chain walked as the product walks it; Landlock is reached by failing the bwrap probe.
 * @param backend - the backend the run must select.
 * @returns the provider.
 */
async function provider(backend: Backend): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  if (backend === 'landlock') sandbox.internals = { probeBwrap: () => false }
  return sandbox
}

/**
 * Run `command` confined under `policy` behind the marker.
 * @param sandbox - the provider.
 * @param backend - the backend the wrap must name.
 * @param command - a `/bin/sh -c` script; `$1` is the status file's path.
 * @param policy - the policy.
 * @param badOption - an option inserted right after the runner program, so the runner refuses before it starts anything.
 * @returns the exit status, stderr and the status file's content.
 */
async function runMarked(
  sandbox: LocalSandboxProvider,
  backend: Backend,
  command: string,
  policy: SandboxPolicy,
  badOption?: string,
): Promise<MarkedRun> {
  const status = join(await tempDir(), 'launch-status')
  const confined = sandbox.confine(['/bin/sh', '-c', INNER, 'dsh-launched', '/bin/sh', '-c', command, 'dsh-command', status], policy)
  expect(confined.backend).toBe(backend)
  const argv = [...confined.argv]
  if (badOption !== undefined) {
    const runner = backend === 'bwrap' ? argv.indexOf('bwrap') : 0
    expect(runner).toBeGreaterThanOrEqual(0)
    argv.splice(runner + 1, 0, badOption)
  }
  const result = spawnSync('/bin/sh', ['-c', OUTER, 'dsh-status', status, ...argv], { timeout: 30_000, encoding: 'utf8' })
  return { exit: result.status, stderr: result.stderr, marker: readFileSync(status, 'utf8') }
}

describe.each(['bwrap', 'landlock'] as const)('P3-03 U2 probe: the launch marker under %s', (backend) => {
  it('is written before the command runs, in read-only and in workspace-write', async () => {
    const workspace = await tempDir()
    const sandbox = await provider(backend)
    for (const mode of ['read-only', 'workspace-write'] as const) {
      const run = await runMarked(sandbox, backend, 'exit 0', { mode, workspaceRoot: workspace })
      expect([mode, run.exit, run.marker], run.stderr).toEqual([mode, 0, 'launched'])
    }
  })

  it('stays when the command prints the runner\'s fatal signature and exits with the runner\'s failure code', async () => {
    const workspace = await tempDir()
    const sandbox = await provider(backend)
    const forged = backend === 'bwrap'
      ? "printf 'bwrap: Can not mount tmpfs\\n' >&2; exit 1"
      : "printf 'landlock-run: cannot restrict this process\\n' >&2; exit 125"
    const run = await runMarked(sandbox, backend, forged, { mode: 'workspace-write', workspaceRoot: workspace })
    expect([run.exit, run.marker], run.stderr).toEqual([backend === 'bwrap' ? 1 : 125, 'launched'])
  })

  it('cannot be written by the command: descriptor 9 is closed and the status file is outside every writable root', async () => {
    const workspace = await tempDir()
    const sandbox = await provider(backend)
    const run = await runMarked(sandbox, backend, 'printf forged >&9; printf forged >> "$1"; printf forged > "$1"; exit 0', { mode: 'workspace-write', workspaceRoot: workspace })
    expect([run.exit, run.marker], run.stderr).toEqual([0, 'launched'])
  })

  it('is absent when the runner refuses before it starts anything: a missing workspace root, an unknown runner option', async () => {
    const sandbox = await provider(backend)
    const missing = await runMarked(sandbox, backend, 'exit 0', { mode: 'workspace-write', workspaceRoot: join(await tempDir(), 'missing') })
    expect([missing.exit === 0, missing.marker], missing.stderr).toEqual([false, ''])
    const refused = await runMarked(sandbox, backend, 'exit 0', { mode: 'workspace-write', workspaceRoot: await tempDir() }, '--dsh-u2-probe-unknown-option')
    expect([refused.exit === 0, refused.marker], refused.stderr).toEqual([false, ''])
  })
})
