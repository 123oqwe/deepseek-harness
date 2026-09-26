/**
 * A-457 under P4-11 acceptance[0] (BLOCKED-339's fix, B-605): on the SHIPPED
 * headless profile, a provider route whose retry policy is `always` still
 * sends a permanent failure only once.
 *
 * `./loader/p4-11-always/failing-llm.ts` serves a route carrying the `always`
 * policy whose first conversation attempt fails as `A457_FAILURE` names and
 * whose later attempts succeed; `./loader/p4-11-always/driver.ts` runs one
 * turn per failure kind in its own process and reports the attempts the
 * adapter saw and the `llm/retry` events the sessions hold. The control is a
 * retryable 503, which the `always` policy does retry.
 * @module tests/first100/fixtures/P4-11.always-permanent.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-11-always/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./loader/p4-11-always/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The failure kinds the adapter can inject. */
const KINDS = ['retryable', 'invalid-request-400', 'invalid-request'] as const

/** What the driver reported for one failure kind. */
interface Result {
  readonly failure: string | null
  readonly attempts: number
  readonly retryEvents: number
  readonly turnEnds: readonly unknown[]
  readonly turnError: string | null
}

const results = new Map<string, Result>()
const failures = new Map<string, string>()

beforeAll(async () => {
  for (const kind of KINDS) {
    try {
      const { stdout, stderr } = await runLoaderSmoke({
        label: `A-457 always policy: ${kind}`,
        tempDirPrefix: `a457-always-${kind}-`,
        binScript: driver,
        libBinScript: driver,
        configPath,
        tsconfigPath: repoTsconfig,
        env: { A457_FAILURE: kind },
      })
      const json = /A457-RESULT (?<json>.+)/u.exec(stdout)?.groups?.json
      if (json === undefined) throw new Error(`the ${kind} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
      results.set(kind, JSON.parse(json) as Result)
    } catch (error: unknown) {
      failures.set(kind, error instanceof Error ? error.message : String(error))
    }
  }
}, KINDS.length * LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * One failure kind's result, or the reason there is none.
 * @param kind - the failure kind.
 * @returns the result.
 */
function resultOf(kind: typeof KINDS[number]): Result {
  const result = results.get(kind)
  if (result === undefined) throw new Error(failures.get(kind) ?? `no result for ${kind}`)
  return result
}

describe('P4-11 acceptance[0] under the always retry policy: a permanent failure is sent once', () => {
  it('control: a retryable 503 is retried, so the route really carries the always policy', () => {
    const result = resultOf('retryable')
    expect([result.attempts, result.retryEvents > 0], JSON.stringify(result)).toEqual([2, true])
  })

  it('a permanent 400 INVALID_REQUEST is sent once and not retried', () => {
    const result = resultOf('invalid-request-400')
    expect([result.attempts, result.retryEvents], JSON.stringify(result)).toEqual([1, 0])
  })

  it('an INVALID_REQUEST with no status, refused before sending, is sent once and not retried', () => {
    const result = resultOf('invalid-request')
    expect([result.attempts, result.retryEvents], JSON.stringify(result)).toEqual([1, 0])
  })
})
