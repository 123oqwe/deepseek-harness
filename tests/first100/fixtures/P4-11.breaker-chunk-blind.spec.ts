/**
 * A-498 under P4-11 acceptance[2] («provider 故障时 circuit 打开且可恢复»): on the
 * pi-ai route, a provider that fails every call never opens the circuit breaker,
 * because pi-ai surfaces a provider failure as an error FINISH CHUNK, not a
 * throw, and the breaker (`@deepseek-ai/dsh-retry-cockatiel`) only counts a
 * failure the guarded first-chunk pull THROWS.
 *
 * `guardedFirstChunk` (`packages/llm/llm/src/index.ts:1053`)
 * wraps `iterator.next()` and treats a produced first chunk as "the endpoint
 * answered". pi-ai's `toStreamChunks` maps provider error events to
 * `kind:'error'` finish chunks (`packages/llm/llm-pi-ai/src/stream.ts`,
 * `adapter.ts` `yield result.value`), so `iterator.next()` RETURNS a value; the
 * breaker records a success and its `ConsecutiveBreaker` never trips.
 *
 * Control: the breaker service itself DOES open after `consecutiveFailures`
 * THROWN failures, isolating the chunk-vs-throw surfacing as the defect.
 *
 * The fake pi-ai backend fails with HTTP 5xx; no real network is used.
 * @module tests/first100/fixtures/P4-11.breaker-chunk-blind
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import CockatielCircuitBreaker from '@deepseek-ai/dsh-retry-cockatiel'
import { BreakerOpenError, type CircuitBreakerContract, type FailureFacts } from '@deepseek-ai/dsh-retry'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from '../../../packages/llm/llm-pi-ai/tests/assemble.ts'
import { closeMockServers, mockServer } from '../../../packages/llm/llm-pi-ai/tests/mock-server.ts'

/** A low threshold so the test drives past it in a few calls; the shipped default is 5. */
const CONSECUTIVE = 2

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** Boot llm + the circuit breaker + the pi-ai adapter against one fake backend. */
async function boot(baseURL: string): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(CockatielCircuitBreaker, { consecutiveFailures: CONSECUTIVE, openMs: 30_000 })
  await ctx.plugin(LlmPiAi, {
    providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${baseURL}/v1` } },
  })
  return ctx
}

/** A fake backend that returns an HTTP 5xx (a provider failure) for every request. */
async function alwaysFailingBackend(): Promise<{ url: string; requestCount: () => number }> {
  const server = await mockServer(Array.from({ length: 64 }, () => ({ status: 500, body: '{"error":{"message":"provider down"}}' })))
  return { url: server.url, requestCount: () => server.requests.length }
}

describe('P4-11 acc[2]: on the pi-ai route a failing provider does not open the circuit breaker', () => {
  it('control: the breaker opens after consecutiveFailures THROWN failures', async () => {
    const ctx = await boot('http://127.0.0.1:1')
    const breaker = ctx.get('circuitBreaker') as unknown as CircuitBreakerContract
    const dest = { provider: 'ctl', baseUrl: 'ctl', model: 'ctl' }
    const boom = (): Promise<never> => Promise.reject(new Error('endpoint down'))
    const retryable = (): FailureFacts => ({}) // empty facts classify as retryable
    // CONSECUTIVE+1 thrown failures leave the breaker OPEN regardless of whether
    // it trips on the threshold-th failure or the one after (BreakerOpenError
    // extends Error, so this covers both the original throw and an early open).
    for (let i = 0; i <= CONSECUTIVE; i++) {
      await expect(breaker.execute(dest, boom, retryable)).rejects.toBeInstanceOf(Error)
    }
    // The next attempt is refused by the OPEN breaker, without running the operation.
    await expect(breaker.execute(dest, boom, retryable)).rejects.toBeInstanceOf(BreakerOpenError)
    await ctx.fiber.dispose()
  })

  it('red: after more than consecutiveFailures pi-ai failures, the breaker must refuse the next call without reaching the backend', async () => {
    const backend = await alwaysFailingBackend()
    const ctx = await boot(backend.url)

    // Drive past the threshold. Every call fails (an error finish chunk).
    for (let i = 0; i <= CONSECUTIVE; i++) {
      const result = await assemble(ctx, { provider: 'openai', model: 'gpt-4.1', messages: [] })
      expect(result.finish.kind, JSON.stringify(result.finish)).toBe('error')
    }

    // Requirement (acc[2]): the breaker is now OPEN, so the next call is refused
    // WITHOUT reaching the backend. Bug: the breaker never opened (pi-ai's error
    // finish chunk was counted as a success), so this call reaches the backend
    // again — the request count grows instead of staying put.
    const before = backend.requestCount()
    await assemble(ctx, { provider: 'openai', model: 'gpt-4.1', messages: [] })
    expect(backend.requestCount(), 'an open breaker must refuse the call without reaching the backend').toBe(before)
    await ctx.fiber.dispose()
  })
})
