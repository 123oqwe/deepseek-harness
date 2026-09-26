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
