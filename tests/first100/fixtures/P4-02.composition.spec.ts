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

/**
 * BLOCKED-232 (e): the block above boots a real Loader tree, but its
 * `cordis.yml` mounts `@deepseek-ai/dsh-run` directly. That closes "a real
 * `dsh-app-boot` boot reaches the compile" and leaves the shipped mount row
 * — `packages/bundle/base/cordis.patch.yml`'s `id: run` — as evidence by
 * READING rather than by observation.
 *
 * This block boots the SHIPPED headless profile through `PROFILE_TEMPLATES`,
 * whose `bundles` list carries `@deepseek-ai/dsh-base`, with a test overlay
 * supplying only a keyless model and a readable session log. Nothing in the
 * overlay mounts the Run Service: if that row stops shipping, these cases go
 * red.
 */
describe('P4-02 mount: the shipped base layer is what compiles the profile', () => {
  const mountDriver = fileURLToPath(new URL('../../../packages/run/task-profile/tests/fixtures/driver.ts', import.meta.url))
  const mountConfig = fileURLToPath(new URL('../../../packages/run/task-profile/tests/fixtures/base-mount.patch.yml', import.meta.url))

  interface MountObservation {
    readonly profileEventCount: number
    readonly derivedRefs: readonly string[]
    readonly handleTaskProfile: string | null
    readonly runTaskProfileRefs: readonly string[]
    readonly runStates: readonly string[]
  }

  /** Boot the shipped profile once and return what the driver reported. */
  async function bootShipped(): Promise<{ mounted: { runs: boolean }; observed: readonly MountObservation[] }> {
    const { stdout } = await runLoaderSmoke({
      label: 'p4-02-base-mount',
      tempDirPrefix: 'p4-02-base-mount-',
      binScript: mountDriver,
      configPath: mountConfig,
      tsconfigPath,
    })
    const mounted = /P4-02-MOUNTED (?<json>.+)/u.exec(stdout)?.groups?.json
    const observed = /P4-02-OBSERVED (?<json>.+)/u.exec(stdout)?.groups?.json
    if (mounted === undefined || observed === undefined) throw new Error(`driver reported nothing usable:\n${stdout}`)
    return { mounted: JSON.parse(mounted) as never, observed: JSON.parse(observed) as never }
  }

  it('mounts the Run Service from the shipped layers, with no row this fixture added', async () => {
    // Separated from the case below so a missing service and a mounted service
    // that compiled nothing report as different failures.
    const { mounted } = await bootShipped()

    expect(mounted).toEqual({ runs: true })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('compiles exactly one profile on the shipped profile boot, and the three records agree', async () => {
    const { observed } = await bootShipped()

    expect(observed).toHaveLength(1)
    const agent = observed[0]!
    expect(agent.profileEventCount).toBe(1)
    // The same digest in the session log, the Run log and on the handle — the
    // property U.1 observes on a hand-mounted tree, now on the shipped one.
    expect(agent.handleTaskProfile).toBe(agent.derivedRefs[0])
    expect(agent.runTaskProfileRefs).toStrictEqual([agent.derivedRefs[0]])
    expect(agent.runStates).toContain('accepted->planning')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
