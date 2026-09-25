/**
 * BLOCKED-281 (b), P4-11 acceptance[0] on the shipped mount: a permanent
 * failure is not retried and charges the Run's retry budget nothing, with a
 * retryable failure as the control that shows the probe sees both.
 *
 * The mount is the one the P4-11 mount slice (`P4-11.composition.spec.ts`)
 * observes: the SHIPPED headless profile through `bootProductionProfile`,
 * with an overlay that only supplies a keyless adapter. That adapter fails its
 * FIRST attempt as `A418_FAILURE` names and succeeds after, so a failure that
 * is retried shows as two attempts. `beforeAll` boots once per failure kind in
 * a child process through `runLoaderSmoke`; the cases only read what the
 * driver reported.
 */
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-11-permanent/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./loader/p4-11-permanent/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The failure kinds the adapter knows. */
const KINDS = ['retryable', 'invalid-request', 'auth'] as const

/** What the driver reported for one boot. */
interface Result {
  readonly failure: string | null
  readonly mounted: { readonly runRetryUsage: boolean }
  readonly attempts: number
  readonly charged: readonly { readonly run: string, readonly retriesUsed: number | null }[]
  readonly retryEvents: number
  readonly turnError: string | null
}

const results = new Map<string, Result>()

beforeAll(async () => {
  for (const kind of KINDS) {
    const { stdout } = await runLoaderSmoke({
      label: `a418-${kind}`,
      tempDirPrefix: 'a418-permanent-',
      binScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { A418_FAILURE: kind },
    })
    const json = /A418-RESULT (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the ${kind} boot reported nothing usable:\n${stdout}`)
    results.set(kind, JSON.parse(json) as Result)
  }
}, KINDS.length * LOADER_SMOKE_TEST_TIMEOUT_MS + 15_000)

/**
 * The largest retry charge any agent's Run carries, `0` when none was charged.
 * @param result - one boot's report.
 * @returns the largest `retriesUsed`, or `0`.
 */
function retriesCharged(result: Result | undefined): number {
  return Math.max(0, ...(result?.charged ?? []).map(entry => entry.retriesUsed ?? 0))
}

describe('P4-11 acceptance[0] on the shipped mount: a permanent failure is not retried and charges nothing', () => {
  it('control: a retryable 503 on the first attempt is retried and charged to the run', () => {
    const result = results.get('retryable')
    expect(result?.mounted.runRetryUsage, JSON.stringify(result)).toBe(true)
    expect(result?.attempts, JSON.stringify(result)).toBe(2)
    expect(retriesCharged(result), JSON.stringify(result)).toBeGreaterThanOrEqual(1)
    expect(result?.retryEvents, JSON.stringify(result)).toBeGreaterThanOrEqual(1)
  })

  it('a permanent 400 invalid request is not retried and charges the run nothing', () => {
    const result = results.get('invalid-request')
    expect(result?.attempts, JSON.stringify(result)).toBe(1)
    expect(retriesCharged(result), JSON.stringify(result)).toBe(0)
    expect(result?.retryEvents, JSON.stringify(result)).toBe(0)
  })

  it('a permanent 403 authentication failure is not retried and charges the run nothing', () => {
    const result = results.get('auth')
    expect(result?.attempts, JSON.stringify(result)).toBe(1)
    expect(retriesCharged(result), JSON.stringify(result)).toBe(0)
    expect(result?.retryEvents, JSON.stringify(result)).toBe(0)
  })
})
