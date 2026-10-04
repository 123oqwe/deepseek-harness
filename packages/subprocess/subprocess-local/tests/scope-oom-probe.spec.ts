/**
 * PROBE — never merge. Epic P3-03 U3 (delegate ruling Q-U3): before the build,
 * read what this runner's user manager keeps about a scope the kernel's OOM
 * killer acted in. The product launches with `systemd-run --user --scope
 * --collect`, so a scope that ends is unloaded at once; the question is
 * whether, without `--collect`, the stopped scope still says `Result=oom-kill`
 * until `reset-failed`, and whether that holds when the killed process is a
 * child of the scope's main process, as the product's runner and target are.
 *
 * An observation, not a gate: every outcome passes, and each reading travels
 * in its case's name so it reaches the JSON report.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'

/** The environment the manager calls run with: plain locale, no systemd log noise. */
const ENV = { ...process.env, LC_ALL: 'C', SYSTEMD_LOG_TARGET: 'null' }

/** A memory ceiling far below what the allocation asks for. */
const CEILING = ['-p', 'MemoryMax=64M', '-p', 'MemorySwapMax=0']

/** Allocates and touches 1 GiB. */
const ALLOCATE = "perl -e '$x = \"x\" x (1024 * 1024 * 1024); print length($x)'"

/** What one scope run left behind. */
interface ScopeReading {
  /** systemd-run's own exit status and signal. */
  readonly exit: string
  /** `LoadState/ActiveState/Result` right after the run. */
  readonly state: string
  /** `oom_kill` from the scope's `memory.events`, or why it could not be read. */
  readonly events: string
  /** `reset-failed` outcome and the `LoadState` after it. */
  readonly reset: string
}

/**
 * Show selected properties of a user unit.
 * @param unit - the unit.
 * @returns the property map.
 */
function show(unit: string): Map<string, string> {
  const result = spawnSync('systemctl', ['--user', 'show', unit, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'Result', '-p', 'ControlGroup'], { env: ENV, encoding: 'utf8', timeout: 15_000 })
  const values = new Map<string, string>()
  for (const line of (result.stdout ?? '').split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) values.set(line.slice(0, at), line.slice(at + 1))
  }
  return values
}

/**
 * Run one scope and read what its manager kept.
 * @param collect - whether to pass `--collect`, as the product does.
 * @param script - the `/bin/sh -c` script the scope runs.
 * @returns the readings.
 */
function runScope(collect: boolean, script: string): ScopeReading {
  if (process.platform !== 'linux') return { exit: 'n/a', state: 'n/a', events: 'n/a', reset: 'n/a' }
  const unit = `dsh-oom-probe-${String(process.pid)}-${randomBytes(6).toString('hex')}.scope`
  const run = spawnSync('systemd-run', [
    '--user', '--scope', '--quiet', ...collect ? ['--collect'] : [], '--expand-environment=no', `--unit=${unit}`, ...CEILING, '--', '/bin/sh', '-c', script,
  ], { env: ENV, encoding: 'utf8', timeout: 60_000 })
  const exit = run.error === undefined ? `${String(run.status)}/${String(run.signal)}` : `error:${run.error.message.split('\n')[0] ?? ''}`
  const after = show(unit)
  const group = after.get('ControlGroup') ?? ''
  const eventsFile = `/sys/fs/cgroup${group}/memory.events`
  const events = group === '' ? 'no-cgroup' : existsSync(eventsFile)
    ? (readFileSync(eventsFile, 'utf8').split('\n').find(line => line.startsWith('oom_kill ')) ?? 'no-oom_kill-line')
    : 'cgroup-gone'
  const state = `${after.get('LoadState') ?? '?'}/${after.get('ActiveState') ?? '?'}/${after.get('Result') ?? '?'}`
  const reset = spawnSync('systemctl', ['--user', 'reset-failed', unit], { env: ENV, encoding: 'utf8', timeout: 15_000 })
  const resetState = `${reset.status === 0 ? 'ok' : `exit-${String(reset.status)}`}/${show(unit).get('LoadState') ?? '?'}`
  return { exit, state, events, reset: resetState }
}

const version = process.platform === 'linux'
  ? (spawnSync('systemctl', ['--version'], { encoding: 'utf8' }).stdout ?? '').split('\n')[0] ?? ''
  : 'n/a'
const clean = runScope(false, 'exit 0')
const oomMain = runScope(false, `exec ${ALLOCATE}`)
const oomCollected = runScope(true, `exec ${ALLOCATE}`)
const oomChild = runScope(false, `${ALLOCATE}; echo "child=$?"`)

/**
 * One reading as a case-name fragment.
 * @param reading - the reading.
 * @returns `exit=… state=… events=… reset=…`.
 */
function named(reading: ScopeReading): string {
  return `exit=${reading.exit} state=${reading.state} events=${reading.events} reset=${reading.reset}`
}

describe(`P3-03 U3 probe: what a user manager keeps about an OOM-killed scope (${process.platform}, ${version})`, () => {
  it(`clean scope, no --collect: ${named(clean)}`, () => {
    expect(typeof clean.state).toBe('string')
  })

  it(`OOM in the main process, no --collect: ${named(oomMain)}`, () => {
    expect(typeof oomMain.state).toBe('string')
  })

  it(`OOM in the main process, --collect (the product today): ${named(oomCollected)}`, () => {
    expect(typeof oomCollected.state).toBe('string')
  })

  it(`OOM in a child while the main process survives, no --collect: ${named(oomChild)}`, () => {
    expect(typeof oomChild.state).toBe('string')
  })
})
