/**
 * Epic P4-11 must[2]: the circuit breaker on the shipped LLM path.
 *
 * The Provider stage proved a `cockatiel` policy refuses through the contract.
 * What it could not prove is that anything the harness ships consults it, and
 * P4-11.P's README said so. These cases mount the real breaker provider beside
 * the real LLM service and observe the ADAPTER's call count: a refusal is
 * refused by not reaching the adapter, which is the only observation that
 * cannot pass while the breaker is consulted and ignored.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CockatielCircuitBreaker from '@deepseek-ai/dsh-retry-cockatiel'
import { BreakerOpenError } from '@deepseek-ai/dsh-retry'

import LlmRuntime, { LlmAdapter, LlmError } from '../src/index.ts'
import type { GenerateOptions, StreamChunk } from '../src/types.ts'

/** Counts dispatches and fails them, so each attempt is one the breaker decides on. */
class FailingAdapter extends LlmAdapter {
  calls = 0

  constructor(private readonly code = 'SERVER', private readonly status = 503) {
    super()
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    await Promise.resolve()
    throw new LlmError('endpoint is down', this.code, { status: this.status })
    yield undefined as unknown as StreamChunk
  }

  override endpointUrl(_provider: string, model: string): string {
    return `https://endpoint.invalid/${model}`
  }
}

async function drain(ctx: Context, model = 'mock'): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({ provider: 'mock', model, messages: [] })) chunks.push(chunk)
  return chunks
}

async function harness(adapter: LlmAdapter, consecutiveFailures = 2): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(CockatielCircuitBreaker, { consecutiveFailures, openMs: 30_000 })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

describe('P4-11 must[2]: a failing endpoint stops being called', () => {
  it('refuses the next call without reaching the adapter once the destination opens', async () => {
    const adapter = new FailingAdapter()
    const ctx = await harness(adapter)

    await drain(ctx)
    await drain(ctx)
    expect(adapter.calls).toBe(2)

    // The refusal is observed as "the adapter was not dispatched", not as a
    // flag a caller could have ignored — and it still arrives as the stream
    // protocol's terminal chunk rather than as an escaping throw.
    const chunks = await drain(ctx)
    expect(adapter.calls).toBe(2)
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { message: expect.stringContaining('circuit breaker open') } },
    })
    await ctx.fiber.dispose()
  })

  it('keeps calling a destination below the threshold', async () => {
    // Without this a breaker that refused everything would satisfy the case
    // above, whose observation is "the count stopped rising".
    const adapter = new FailingAdapter()
    const ctx = await harness(adapter, 5)

    await drain(ctx)
    await drain(ctx)
    await drain(ctx)
    expect(adapter.calls).toBe(3)
    await ctx.fiber.dispose()
  })

  it('does not open on a failure the classifier calls permanent', async () => {
    // A malformed request says nothing about the endpoint's health. Four
    // dispatches past a threshold of two, and every one reaches the adapter.
    const adapter = new FailingAdapter('INVALID_REQUEST', 400)
    const ctx = await harness(adapter)

    for (let attempt = 0; attempt < 4; attempt += 1) await drain(ctx)
    expect(adapter.calls).toBe(4)
    await ctx.fiber.dispose()
  })

  it('opens one model without opening another on the same provider', async () => {
    // Keyed per destination: `endpointUrl` differs per model here, and one
    // sick model must not close the door on a working one.
    const adapter = new FailingAdapter()
    const ctx = await harness(adapter)

    await drain(ctx, 'sick')
    await drain(ctx, 'sick')
    const refused = await drain(ctx, 'sick')
    expect(refused.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
    const before = adapter.calls

    await drain(ctx, 'healthy')
    expect(adapter.calls).toBe(before + 1)
    await ctx.fiber.dispose()
  })

  it('dispatches normally when no breaker is mounted', async () => {
    // Capability absence: a composition without the provider keeps working,
    // and this is what makes the mount the thing under test rather than the
    // LLM service's own behaviour.
    const adapter = new FailingAdapter()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['mock'], adapter)

    for (let attempt = 0; attempt < 4; attempt += 1) await drain(ctx)
    expect(adapter.calls).toBe(4)
    expect(BreakerOpenError.name).toBe('BreakerOpenError')
    await ctx.fiber.dispose()
  })
})
