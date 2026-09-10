import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BreakerOpenError, type BreakerDestination } from '@deepseek-ai/dsh-retry'
import { LlmError, llmFailureFacts, normalizeLlmFailure } from '@deepseek-ai/dsh-llm'

import CockatielCircuitBreaker, { Config } from '@deepseek-ai/dsh-retry-cockatiel'

const DEEPSEEK: BreakerDestination = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
}

/** The classifier every case uses: the real adapter-failure translation. */
const classify = (error: unknown) => llmFailureFacts(normalizeLlmFailure(error))

/**
 * A failure value of the shape `llm-deepseek` actually throws — its adapter
 * builds `new LlmError(message, httpErrorCode(status), ...)` — rather than a
 * hand-built `FailureFacts`, so the case observes the whole translation.
 */
function serverFailure(): LlmError {
  return new LlmError('DeepSeek API request failed', 'SERVER', { status: 503 })
}

async function breaker(config: Partial<Config> = {}): Promise<CockatielCircuitBreaker> {
  const ctx = new Context()
  await ctx.plugin(CockatielCircuitBreaker, { consecutiveFailures: 3, openMs: 30_000, ...config })
  return ctx.circuitBreaker as CockatielCircuitBreaker
}

/** An operation that counts how many times it was actually run. */
function countingStub(outcome: () => Promise<unknown>): { calls: number; run: () => Promise<unknown> } {
  const stub = {
    calls: 0,
    run: async () => {
      stub.calls += 1
      return outcome()
    },
  }
  return stub
}

describe('P4-11 circuit breaker provider', () => {
  it('refuses an attempt at the threshold without reaching the operation', async () => {
    const service = await breaker()
    const stub = countingStub(async () => { throw serverFailure() })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.execute(DEEPSEEK, stub.run, classify)).rejects.toBeInstanceOf(LlmError)
    }
    expect(stub.calls).toBe(3)

    // The refusal is observed as "the operation did not run", not as a flag a
    // caller could have ignored.
    await expect(service.execute(DEEPSEEK, stub.run, classify)).rejects.toBeInstanceOf(BreakerOpenError)
    expect(stub.calls).toBe(3)
  })

  it('still executes below the threshold', async () => {
    const service = await breaker()
    const stub = countingStub(async () => { throw serverFailure() })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(service.execute(DEEPSEEK, stub.run, classify)).rejects.toBeInstanceOf(LlmError)
    }
    // Without this a provider that refused everything would satisfy the case
    // above.
    const alive = countingStub(async () => 'ok')
    await expect(service.execute(DEEPSEEK, alive.run, classify)).resolves.toBe('ok')
    expect(alive.calls).toBe(1)
  })

  it('opens one destination without opening another under the same provider', async () => {
    const service = await breaker()
    const sick = countingStub(async () => { throw serverFailure() })
    const healthy = countingStub(async () => 'ok')
    const other: BreakerDestination = { ...DEEPSEEK, model: 'deepseek-reasoner' }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.execute(DEEPSEEK, sick.run, classify)).rejects.toBeInstanceOf(LlmError)
    }
    await expect(service.execute(DEEPSEEK, sick.run, classify)).rejects.toBeInstanceOf(BreakerOpenError)

    // Keyed per destination: one provider name fronts both, and a sick model
    // must not close the door on a working one.
    await expect(service.execute(other, healthy.run, classify)).resolves.toBe('ok')
    expect(healthy.calls).toBe(1)
  })

  it('does not count a failure the classifier calls permanent', async () => {
    const service = await breaker()
    const stub = countingStub(async () => {
      throw new LlmError('DeepSeek rejected the request', 'INVALID_REQUEST', { status: 400 })
    })

    // Four attempts past a threshold of three: a malformed request says
    // nothing about the endpoint's health, so the destination stays closed and
    // every attempt reaches the operation.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(service.execute(DEEPSEEK, stub.run, classify)).rejects.toBeInstanceOf(LlmError)
    }
    expect(stub.calls).toBe(4)
  })

  it('returns the caller its own error, not a breaker-internal one', async () => {
    const service = await breaker()
    const original = serverFailure()
    const stub = countingStub(async () => { throw original })

    await expect(service.execute(DEEPSEEK, stub.run, classify)).rejects.toBe(original)
  })
})
