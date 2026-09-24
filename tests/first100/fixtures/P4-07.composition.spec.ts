/**
 * P4-07 on the SHIPPED headless profile: what a displaced host may still write
 * when its session ends, and what an agent may do when the lease store fails
 * while its lease is taken.
 *
 * Each case boots the shipped profile once through `bootProductionProfile`, in
 * a child process (`tests/first100/fixtures/p4-07/driver.ts`). The overlay only
 * turns off the entry rows, mounts no profile agent and supplies a keyless
 * model; the `run` and `lease-store` rows are the ones
 * `packages/bundle/base/cordis.patch.yml` ships.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const driver = fileURLToPath(new URL('./p4-07/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./p4-07/base-mount.patch.yml', import.meta.url))

/** A Run as the driver reports it. */
interface RunRecord {
  readonly state: string
  readonly transitions: readonly string[]
}

/** What the driver reports after a session ends. */
interface EndObservation {
  readonly firstEpoch: number | null
  readonly second: { readonly acquired: boolean; readonly epoch: number | null } | null
  readonly displacedRecord: RunRecord | null
  readonly after: RunRecord | null
}

/** What the driver reports after a session ended as its host unloaded. */
interface UnloadObservation {
  readonly before: RunRecord | null
  readonly after: RunRecord | null
}

/** What the driver reports after a tool turn. */
interface ToolObservation {
  readonly precondition: { readonly leasedBeforeStart: readonly string[]; readonly leaseRow: boolean; readonly run: boolean }
  readonly leaseRefused: boolean
  readonly results: readonly { readonly isError: boolean; readonly error: { readonly name?: string } | null }[]
  readonly todoWrites: number
}

/**
 * Boot the shipped profile once in `mode` and return what the driver reported.
 * @param mode - the driver's `P4_07_MODE`.
 * @returns the parsed observation.
 */
async function boot<T>(mode: string): Promise<T> {
  const { stdout } = await runLoaderSmoke({
    label: `p4-07 ${mode}`,
    tempDirPrefix: 'p4-07-',
    binScript: driver,
    configPath: overlay,
    tsconfigPath,
    env: { P4_07_MODE: mode },
  })
  const observed = /P4-07-OBSERVED (?<json>.+)/u.exec(stdout)?.groups?.json
  if (observed === undefined) throw new Error(`driver reported nothing usable:\n${stdout}`)
  return JSON.parse(observed) as T
}

/**
 * The tool turn of a session whose lease the store failed to grant. No other
 * agent held or renewed a lease while the lock was held, the failure was at
 * the lease (no row and no Run for this session), and every tool call was
 * refused for the lease, so its effect never happened.
 * @param observed - the driver's report.
 */
function expectRefusedToolTurn(observed: ToolObservation): void {
  expect(observed.precondition).toStrictEqual({ leasedBeforeStart: [], leaseRow: false, run: false })
  expect(observed.todoWrites).toBe(0)
  expect(observed.results.length).toBeGreaterThan(0)
  for (const result of observed.results) {
    expect(result.isError).toBe(true)
    expect(result.error?.name).toBe('LeaseRefusedError')
  }
}

describe('P4-07 on the shipped profile: a displaced host and a failing lease store', () => {
  it('a displaced host\'s session end leaves the Run\'s recorded outcome unchanged (acceptance[0])', async () => {
    const observed = await boot<EndObservation>('displaced')

    // The displacement happened, and the Run was mid-work when it did.
    expect(observed.second?.acquired).toBe(true)
    expect(observed.second?.epoch).toBeGreaterThan(observed.firstEpoch ?? Number.POSITIVE_INFINITY)
    expect(observed.displacedRecord?.state).toBe('running')
    // The session ended on the displaced host and wrote nothing to the Run.
    expect(observed.after).toStrictEqual(observed.displacedRecord)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('the host that still holds the lease records the Run\'s outcome when its session ends (control)', async () => {
    const observed = await boot<EndObservation>('holder')

    expect(observed.after?.state).toBe('succeeded')
    expect(observed.after?.transitions.slice(-2)).toStrictEqual(['running->verifying', 'verifying->succeeded'])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('a host displaced before its first model step ends its session without writing the Run\'s cancellation (acceptance[0])', async () => {
    const observed = await boot<EndObservation>('displaced-early')

    expect(observed.second?.acquired).toBe(true)
    // `accepted` admits `cancelled`, so only the fence keeps that write out.
    expect(observed.displacedRecord?.state).toBe('accepted')
    expect(observed.after).toStrictEqual(observed.displacedRecord)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('the holder\'s session that ends as its host unloads still records the Run\'s outcome', async () => {
    const observed = await boot<UnloadObservation>('holder-unload')

    expect(observed.before?.state).toBe('running')
    expect(observed.after?.state).toBe('succeeded')
    expect(observed.after?.transitions.slice(-2)).toStrictEqual(['running->verifying', 'verifying->succeeded'])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('a lease store that throws while the lease is taken stops the agent\'s tool calls (acceptance[2])', async () => {
    const observed = await boot<ToolObservation>('busy-acquire')

    expectRefusedToolTurn(observed)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('a lease store that throws while the predecessor is read stops the agent\'s tool calls (acceptance[2])', async () => {
    const observed = await boot<ToolObservation>('busy-read')

    expectRefusedToolTurn(observed)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('the same tool call executes when the lease store is healthy (control)', async () => {
    const observed = await boot<ToolObservation>('healthy')

    expect(observed.precondition).toStrictEqual({ leasedBeforeStart: [], leaseRow: true, run: true })
    expect(observed.leaseRefused).toBe(false)
    expect(observed.todoWrites).toBe(1)
    expect(observed.results).toHaveLength(1)
    expect(observed.results[0]?.isError).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
