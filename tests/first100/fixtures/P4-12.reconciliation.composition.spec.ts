/**
 * P4-12 on the SHIPPED headless profile: an ambiguous external effect enters
 * reconciliation and leaves it resolved (BLOCKED-311, acceptance[1]). Red first
 * for lane B's B-515.
 *
 * Each case boots the shipped profile once through `bootProductionProfile`, in
 * a child process (`tests/first100/fixtures/p4-12-reconciliation/driver.ts`).
 * The driver drives one idempotency key to `ambiguous` through the mounted
 * `ctx.actionLedger`, then asks the host user to resolve it with the shipped
 * `/resolve-effect <key> <confirmed|compensated>` command, a test answerer
 * standing in for the host user at the existing approval surface, and reads the
 * entry back. The overlay keeps the `action-ledger`, `commands` and
 * `user-approval` rows `packages/bundle/base/cordis.patch.yml` ships.
 *
 * Today the command is not registered, so `commands.execute` returns
 * `undefined` and the entry stays `ambiguous`: the approve cases fail their
 * assertions (red) with no build error, because the driver calls no new API.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const driver = fileURLToPath(new URL('./p4-12-reconciliation/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./p4-12-reconciliation/base-mount.patch.yml', import.meta.url))

/** What the driver reports after one resolve attempt. */
interface Observation {
  readonly mode: string
  readonly requested: string
  readonly dispatched: boolean
  readonly before: string | null
  readonly after: { readonly state: string; readonly resolution: unknown } | null
  readonly reReserve: { readonly action: string; readonly reason: string | null }
}

/** What the driver reports in `child-scope` mode (B-515 v2): a child agent's ambiguous entry the host tries to resolve. */
interface ChildObservation {
  readonly mode: string
  /** The child agent's scope the entry was reserved under (`agent:<childSessionId>`). */
  readonly childScope: string
  /** The text of the host's no-arg `/resolve-effect` list. */
  readonly hostList: string | null
  /** The text of the host's `/resolve-effect <childKey> confirmed`. */
  readonly resolveText: string | null
  /** The child's entry, read back under its own scope after the host's resolve. */
  readonly childAfter: { readonly state: string; readonly resolution: unknown } | null
}

/**
 * Boot the shipped profile once in `mode` and return what the driver reported.
 * @param mode - the driver's `P4_12_MODE`.
 * @returns the parsed observation.
 */
async function boot(mode: string): Promise<Observation> {
  const { stdout } = await runLoaderSmoke({
    label: `p4-12 ${mode}`,
    tempDirPrefix: 'p4-12-',
    binScript: driver,
    configPath: overlay,
    tsconfigPath,
    env: { P4_12_MODE: mode },
  })
  const observed = /P4-12-OBSERVED (?<json>.+)/u.exec(stdout)?.groups?.json
  if (observed === undefined) throw new Error(`driver reported nothing usable:\n${stdout}`)
  return JSON.parse(observed) as Observation
}

/**
 * Boot the shipped profile once in `child-scope` mode.
 * @returns the parsed child-scope observation.
 */
async function bootChildScope(): Promise<ChildObservation> {
  const { stdout } = await runLoaderSmoke({
    label: 'p4-12 child-scope',
    tempDirPrefix: 'p4-12-',
    binScript: driver,
    configPath: overlay,
    tsconfigPath,
    env: { P4_12_MODE: 'child-scope' },
  })
  const observed = /P4-12-OBSERVED (?<json>.+)/u.exec(stdout)?.groups?.json
  if (observed === undefined) throw new Error(`driver reported nothing usable:\n${stdout}`)
  return JSON.parse(observed) as ChildObservation
}

describe('P4-12 on the shipped profile: an ambiguous effect is reconciled by an operator resolve', () => {
  // Cases 1, 5 and 6 read one approved-to-confirmed run, so it boots once.
  let confirmed: Observation
  beforeAll(async () => { confirmed = await boot('approve-confirmed') }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('the entry is ambiguous before the resolve, and an approved resolve moves it to confirmed, never prepared (acceptance[1])', () => {
    expect(confirmed.before).toBe('ambiguous')
    expect(confirmed.dispatched).toBe(true)
    expect(confirmed.after?.state).toBe('confirmed')
    expect(confirmed.after?.state).not.toBe('prepared')
  })

  it('an approved resolve to compensated settles the entry, never prepared (acceptance[1])', async () => {
    const observed = await boot('approve-compensated')
    expect(observed.before).toBe('ambiguous')
    expect(observed.after?.state).toBe('compensated')
    expect(observed.after?.state).not.toBe('prepared')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('a refused resolve leaves the entry ambiguous and records no resolution (control)', async () => {
    const observed = await boot('refuse')
    expect(observed.after?.state).toBe('ambiguous')
    expect(observed.after?.resolution).toBeNull()
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('a caller that is not the host user cannot resolve; the entry stays ambiguous (control)', async () => {
    const observed = await boot('non-host')
    expect(observed.after?.state).toBe('ambiguous')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('an approved resolve records who resolved the entry and to what', () => {
    expect(confirmed.after?.resolution).not.toBeNull()
    expect(confirmed.after?.resolution).toMatchObject({ outcome: 'confirmed' })
  })

  it('after an approved resolve, a fresh reserve on the same key is no longer refused as ambiguous (acceptance[1])', () => {
    expect(confirmed.reReserve.reason).not.toBe('ambiguous-needs-reconciliation')
  })
})

describe('P4-12 B-515 v2 (BLOCKED-311): the host resolves an ambiguous entry whose scope is not its own', () => {
  it('the host lists and resolves a child agent\'s ambiguous entry, and the resolution keeps the original (child) scope', async () => {
    const observed = await bootChildScope()
    // The entry is reserved under a child agent's scope, not the host user's.
    expect(observed.childScope, JSON.stringify(observed)).toMatch(/^agent:/u)
    // The host's no-arg list names the child's key (red today: the list queries the host's own scope).
    expect(observed.hostList ?? '', JSON.stringify(observed)).toContain('p4-12-effect')
    // The host's resolve settles the child's entry, recorded under its original (child) scope
    // (red today: `entry(hostScope, key)` is undefined, so the child entry stays ambiguous).
    expect(observed.childAfter?.state, JSON.stringify(observed)).toBe('confirmed')
    expect(observed.childAfter?.resolution, JSON.stringify(observed)).not.toBeNull()
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
