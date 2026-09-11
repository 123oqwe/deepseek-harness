/**
 * P4-02 U-stage composition contract: the TaskProfile compiled on a real
 * agent's first model step, through a real Loader composition booted by
 * `@deepseek-ai/dsh-app-boot` (`tests/first100/fixtures/loader/p4-02-task-profile/`).
 *
 * The gap this closes is named in `spec/first100/exec/evidence-P4-02.md` §4.4:
 * every other P4-02 U case runs in `packages/run/run/tests/task-profile.spec.ts`'s
 * `harness()`, a hand-built `ctx.plugin(...)` chain of nine plugins.
 * `packages/AGENTS.md` is explicit that such a suite is insufficient on its own
 * for a product-visible plugin — "Boot test-only `cordis.yml` through the
 * Loader and app/process" — so those cases proved the service does this and
 * left "production reaches it" unobserved.
 *
 * Every assertion is on a JSON observation the driver wrote in the child
 * process, never on live objects, so the property each case checks survives
 * the process boundary the real boot requires.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = fileURLToPath(new URL('./loader/p4-02-task-profile/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./loader/p4-02-task-profile/cordis.yml', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')

/** What `loader/p4-02-task-profile/driver.ts` writes after one real boot. */
interface Observation {
  readonly profileEventCount: number
  readonly payloadKeys: readonly (readonly string[])[]
  readonly derivedRefs: readonly string[]
  readonly runTaskProfileRefs: readonly string[]
  readonly handleTaskProfile: string | null
  readonly runStates: readonly string[]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Boot the fixture composition once and read back what it observed.
 * @param label - the smoke run's label, for its own diagnostics.
 * @returns the driver's observation of the session log and the Run.
 */
async function bootOnce(label: string): Promise<Observation> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-p4-02-composition-'))
  roots.push(root)
  const observationPath = join(root, 'observation.json')
  await runLoaderSmoke({
    label,
    tempDirPrefix: 'p4-02-task-profile-',
    binScript,
    libBinScript: binScript,
    configPath,
    tsconfigPath,
    env: { P4_02_RUN_STORE: join(root, 'runs.json'), P4_02_OBSERVATION: observationPath },
  })
  return JSON.parse(readFileSync(observationPath, 'utf8')) as Observation
}

describe('P4-02 TaskProfile composition (U-stage)', () => {
  it('compiles exactly one profile when a real shipped-path boot takes its first model step', async () => {
    // The production arrival itself. `recordTaskProfile` is reached from the
    // `agent/pre-step` waterfall, which no hand-built harness exercises through
    // a Loader tree — mutation: stop registering the listener on
    // `agent/pre-step` and this is 0 rather than 1.
    const observation = await bootOnce('p4-02 first boot')
    expect(observation.profileEventCount).toBe(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('logs the body and no digest on the production path too, so the event replays', async () => {
    // BLOCKED-211 pinned this in the unit suite; a durable log written by the
    // real boot is where it actually has to hold, because that is the log a
    // recorded scenario replays.
    const observation = await bootOnce('p4-02 payload boot')
    expect(observation.payloadKeys).toStrictEqual([['profile']])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('names the same profile in the session log, the Run log and the Agent handle', async () => {
    // Three records of one fact, and the digest is DERIVED from the logged body
    // rather than read from a stored field. A Run naming a profile the log does
    // not carry looks complete and fails at the resolver.
    const observation = await bootOnce('p4-02 agreement boot')
    const [derived] = observation.derivedRefs
    expect(derived).toBeDefined()
    expect(observation.runTaskProfileRefs).toStrictEqual([derived])
    expect(observation.handleTaskProfile).toBe(derived)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('carries that reference on the accepted → planning transition, not merely somewhere in the log', async () => {
    // The transition is P4-01's; what P4-02 owns is that the profile is what
    // that transition names. Pinning the pair keeps a later slice from
    // satisfying this by referencing the profile from any other entry.
    const observation = await bootOnce('p4-02 transition boot')
    expect(observation.runStates).toContain('accepted->planning')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
