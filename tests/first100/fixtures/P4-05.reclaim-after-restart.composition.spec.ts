/**
 * P4-05 acceptance[2] on the SHIPPED headless profile: "after a restart an
 * orphaned Agent can be reclaimed or fails safely" (BLOCKED-QUEUE register 3406,
 * BLOCKED-092 second step, BLOCKED-264). Observed across a real process
 * boundary, which is what "after a restart" requires and what no P4-05-owned
 * case observed before — `takeover.spec.ts` proves the mechanism, but on a
 * hand-built two-plugin composition, not the shipped profile.
 *
 * `./loader/p4-05-reclaim/driver.ts` self-orchestrates two phase processes over
 * one shared `DSH_HOME`: phase 1 boots the shipped profile, opens a durable Run
 * with its lease, and is SIGKILLed with no cleanup (a real crash, leaving the
 * lease held and un-renewed); the orchestrator polls the durable lease until it
 * lapses; phase 2 boots the shipped profile over the same `DSH_HOME` and adopts
 * the orphaned Run. The shipped `run` and `lease-store` rows stay durable (only
 * the model is mocked and the lease shortened), so this reads one shipped
 * composition's reclaim.
 * @module tests/first100/fixtures/P4-05.reclaim-after-restart.composition
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const driver = fileURLToPath(new URL('./loader/p4-05-reclaim/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-05-reclaim/base.patch.yml', import.meta.url))
const raceOverlay = fileURLToPath(new URL('./loader/p4-05-reclaim/base-race.patch.yml', import.meta.url))

/** Phase 1's reading: the Run it opened before it was killed. */
interface PhaseOne {
  readonly runId: string | null
  readonly epoch: number | null
}

/** Phase 2's reading: what it adopted after the restart. */
interface PhaseTwo {
  readonly restored: number
  readonly runId: string | null
  readonly state: string | null
  readonly epoch: number | null
  readonly leaseRefused: true | null
}

/** What the orchestrator reported. */
interface Observed {
  readonly phase1: PhaseOne
  readonly phase2: PhaseTwo
  readonly lapsed: boolean
}

/** Phase 3's reading (safe-fail): what became of the Run whose session was deleted. */
interface PhaseThree {
  readonly restored: number
  readonly runId: string | null
  readonly state: string | null
}

/** What the orchestrator reported for the safe-fail scenario. */
interface SafeFailObserved {
  readonly phase1: PhaseOne
  readonly phase3: PhaseThree
  readonly lapsed: boolean
}

/**
 * Run the two-phase driver once.
 * @returns the orchestrator's combined reading.
 */
async function boot(): Promise<Observed> {
  const { stdout } = await runLoaderSmoke({
    label: 'p4-05 reclaim after restart',
    tempDirPrefix: 'p4-05-reclaim-',
    binScript: driver,
    configPath: overlay,
    tsconfigPath,
  })
  const observed = /P4-05-ACC2 (?<json>.+)/u.exec(stdout)?.groups?.json
  if (observed === undefined) throw new Error(`driver reported nothing usable:\n${stdout}`)
  return JSON.parse(observed) as Observed
}

/**
 * Run the driver in the safe-fail scenario: phase 1 crashes with its Run
 * durable, the orchestrator deletes the session log, phase 3 boots and reports
 * the Run.
 * @returns the orchestrator's safe-fail reading.
 */
async function bootSafeFail(): Promise<SafeFailObserved> {
  const { stdout } = await runLoaderSmoke({
    label: 'p4-05 safe fail after restart',
    tempDirPrefix: 'p4-05-safe-fail-',
    binScript: driver,
    configPath: overlay,
    tsconfigPath,
    env: { P4_05_RECLAIM_SCENARIO: 'safe-fail' },
  })
  const observed = /P4-05-SAFEFAIL (?<json>.+)/u.exec(stdout)?.groups?.json
  if (observed === undefined) throw new Error(`safe-fail driver reported nothing usable:\n${stdout}`)
  return JSON.parse(observed) as SafeFailObserved
}

/** What the orchestrator reported for the safe-fail RACE scenario (A-568). */
interface RaceObserved {
  readonly phase1: PhaseOne
  readonly phase3: PhaseThree
}

/**
 * Run the driver in the safe-fail-race scenario (A-568): phase 1 crashes with
 * its Run durable, the orchestrator deletes the session and boots phase 3
 * BEFORE the (longer, race-overlay) lease lapses, so the mount-time sweep is
 * denied; phase 3 polls the Run past the lease's lapse within a bounded T.
 * @returns the orchestrator's safe-fail-race reading.
 */
async function bootSafeFailRace(): Promise<RaceObserved> {
  const { stdout } = await runLoaderSmoke({
    label: 'p4-05 safe fail race after restart',
    tempDirPrefix: 'p4-05-safe-fail-race-',
    binScript: driver,
    configPath: raceOverlay,
    tsconfigPath,
    env: { P4_05_RECLAIM_SCENARIO: 'safe-fail-race' },
    // The orchestrator's budget must strictly exceed phase 3's own poll window
    // (30s, P4_05_RACE): phase 1 (~5s) + phase 3's poll (30s) + its report, so
    // it always reaches the P4-05-SAFEFAIL-RACE line rather than being killed
    // mid-poll (which left empty stdout and a timeout, not the state red).
    processTimeoutMs: 90_000,
  })
  const observed = /P4-05-SAFEFAIL-RACE (?<json>.+)/u.exec(stdout)?.groups?.json
  if (observed === undefined) throw new Error(`safe-fail-race driver reported nothing usable:\n${stdout}`)
  return JSON.parse(observed) as RaceObserved
}

describe('P4-05 acceptance[2] on the shipped profile: an orphaned Run is reclaimed after a real restart', () => {
  it('a crashed host\'s durable Run is adopted by the next boot — same Run, walked through orphaned to starting under a new epoch, its lease not refused', async () => {
    const observed = await boot()
    // The predecessor's lease actually lapsed before phase 2 booted, so this is
    // a reclaim after a crash rather than a fresh session on a free item.
    expect(observed.lapsed, JSON.stringify(observed)).toBe(true)
    // Phase 2 restored the crashed host's Run from the shared durable store.
    expect(observed.phase2.restored, JSON.stringify(observed)).toBeGreaterThan(0)
    expect(observed.phase1.runId, JSON.stringify(observed)).not.toBeNull()
    // The SAME Run is reclaimed, not a fresh mint that silently drops the orphan.
    expect(observed.phase2.runId, JSON.stringify(observed)).toBe(observed.phase1.runId)
    // Reached through the real transition table (orphaned on the way in), and a
    // NEW epoch, so the reclaim writes under authority this store issued it.
    expect(observed.phase2.state, JSON.stringify(observed)).toBe('starting')
    expect(observed.phase2.epoch ?? 0, JSON.stringify(observed)).toBeGreaterThan(observed.phase1.epoch ?? 0)
    expect(observed.phase2.leaseRefused, JSON.stringify(observed)).toBeNull()
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 3)
})

describe('P4-05 acceptance[2] on the shipped profile: an orphaned Run whose session is gone fails safely rather than dangling (A-560, red first for B-674)', () => {
  it('a durable Run left with no recoverable session after a crash is recorded FAILED on the next boot, not left forever in a non-terminal state', async () => {
    const observed = await bootSafeFail()
    // The crash left the Run durable but its session deleted — the residual a
    // crash between the Run persisting and the session persisting produces.
    expect(observed.lapsed, JSON.stringify(observed)).toBe(true)
    expect(observed.phase1.runId, JSON.stringify(observed)).not.toBeNull()
    // The Run is still in the shared store after the restart (its session, not
    // its Run record, was deleted).
    expect(observed.phase3.restored, JSON.stringify(observed)).toBeGreaterThan(0)
    expect(observed.phase3.runId, JSON.stringify(observed)).toBe(observed.phase1.runId)
    // acceptance[2]'s "fails safely" branch: it can be neither adopted (no
    // session to resume) nor left dangling, so the restart must record it in a
    // terminal FAILED state. Today nothing sweeps it, so it stays non-terminal.
    expect(observed.phase3.state, JSON.stringify(observed)).toBe('failed')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 3)
})

describe('P4-05 acceptance[2] on the shipped profile: a sessionless Run whose restart raced a still-valid lease still fails safely in bounded time (A-568, red first for B-678)', () => {
  it('a durable Run whose session is gone, whose restart\'s mount-time sweep was denied by the predecessor\'s still-valid lease, is recorded FAILED within bounded time after the lease lapses, not left non-terminal forever', async () => {
    const observed = await bootSafeFailRace()
    // The Run persisted; its session was deleted before phase 3 booted.
    expect(observed.phase1.runId, JSON.stringify(observed)).not.toBeNull()
    expect(observed.phase3.restored, JSON.stringify(observed)).toBeGreaterThan(0)
    expect(observed.phase3.runId, JSON.stringify(observed)).toBe(observed.phase1.runId)
    // The mount-time sweep ran while the predecessor's (longer, race-overlay)
    // lease was still valid, so it was denied. The safe-fail arm requires that,
    // once the lease lapses, the sessionless Run still reaches FAILED within a
    // bounded time (phase 3 polls for ~30s, several times the 8s lease). Today
    // the sweep runs only once at mount and never retries after the lease frees,
    // so the Run stays non-terminal forever — RED. B-678 must fail it in bounded
    // time regardless of the mount-time race.
    expect(observed.phase3.state, JSON.stringify(observed)).toBe('failed')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 3)
})
