/**
 * BLOCKED-347 (P4-11 acceptance[2]): an adapter that reports a provider
 * failure in its stream, as pi-ai does, moves the circuit breaker the way one
 * that throws does, and the shared classifier still decides whether it counts.
 * Each case observes the adapter's call count, as `circuit-breaker.spec.ts`
 * does: a refusal is a call that never reaches the adapter.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CockatielCircuitBreaker from '@deepseek-ai/dsh-retry-cockatiel'

import LlmRuntime, { LlmAdapter } from '../src/index.ts'
import type { FinishReason, GenerateOptions, StreamChunk } from '../src/types.ts'

const USAGE: StreamChunk = { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }

/** Streams the same chunks on every call and counts the calls. */
class ScriptedAdapter extends LlmAdapter {
  calls = 0

  constructor(private readonly chunks: readonly StreamChunk[]) {
    super()
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    await Promise.resolve()
    yield* this.chunks
  }

  override endpointUrl(_provider: string, model: string): string {
    return `https://endpoint.invalid/${model}`
  }
}

/** A usage chunk, then a finish: how pi-ai ends a call that failed before it answered. */
function inBand(reason: FinishReason): StreamChunk[] {
  return [USAGE, { type: 'finish', reason }]
}

/** In-band outcomes the breaker must not count, each with what it is. */
const UNCOUNTED: ReadonlyArray<readonly [string, FinishReason]> = [
  ['a malformed request', { kind: 'error', failure: { message: 'bad request', code: 'INVALID_REQUEST', status: 400 } }],
  ['the caller\'s own abort', { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } }],
  ['a completion that carries no failure', { kind: 'stop' }],
]

async function drain(ctx: Context): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({ provider: 'mock', model: 'mock', messages: [] })) chunks.push(chunk)
  return chunks
}

async function harness(adapter: LlmAdapter, breaker = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  if (breaker) await ctx.plugin(CockatielCircuitBreaker, { consecutiveFailures: 2, openMs: 30_000 })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

describe('BLOCKED-347: a failure reported in the stream moves the breaker like a thrown one', () => {
  it('opens on a failure an adapter reports in its finish chunk, and passes the stream on unchanged', async () => {
    const chunks = inBand({ kind: 'error', failure: { message: 'provider down', code: 'SERVER', status: 503 } })
    const adapter = new ScriptedAdapter(chunks)
    const ctx = await harness(adapter)

    // Below the threshold the consumer receives the adapter's own chunks, the
    // usage chunk included, not a failure the runtime synthesized.
    expect(await drain(ctx)).toEqual(chunks)
    expect(await drain(ctx)).toEqual(chunks)
    expect(adapter.calls).toBe(2)

    const refused = await drain(ctx)
    expect(adapter.calls).toBe(2)
    const last = refused.at(-1)
    const failure = last?.type === 'finish' && last.reason.kind === 'error' ? last.reason.failure : undefined
    expect(failure?.message).toContain('circuit breaker open')
    await ctx.fiber.dispose()
  })

  it.each(UNCOUNTED)('does not open on %s, which the classifier does not count', async (_name, reason) => {
    const adapter = new ScriptedAdapter(inBand(reason))
    const ctx = await harness(adapter)

    for (let attempt = 0; attempt < 4; attempt += 1) await drain(ctx)
    expect(adapter.calls).toBe(4)
    await ctx.fiber.dispose()
  })

  it('does not count a failure that arrives after the stream answered', async () => {
    // The breaker judges where the stream first answers; a text delta is an
    // answer, so the error finish after it is the model's or the transport's.
    const adapter = new ScriptedAdapter([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'partial' },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'stream cut', code: 'SERVER', status: 503 } } },
    ])
    const ctx = await harness(adapter)

    for (let attempt = 0; attempt < 4; attempt += 1) await drain(ctx)
    expect(adapter.calls).toBe(4)
    await ctx.fiber.dispose()
  })

  it('leaves a stream that ends after its usage chunk to the stream invariant, which refuses it', async () => {
    // Such a stream neither answered nor failed: the breaker counts nothing
    // against the endpoint, and the protocol's own check reports the missing
    // finish chunk.
    const adapter = new ScriptedAdapter([USAGE])
    const ctx = await harness(adapter)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(drain(ctx)).rejects.toThrow('LLM stream ended without a terminal finish chunk')
    }
    expect(adapter.calls).toBe(3)
    await ctx.fiber.dispose()
  })

  it('passes an in-band failure on unchanged when no breaker is mounted', async () => {
    const chunks = inBand({ kind: 'error', failure: { message: 'provider down', code: 'SERVER', status: 503 } })
    const adapter = new ScriptedAdapter(chunks)
    const ctx = await harness(adapter, false)

    for (let attempt = 0; attempt < 3; attempt += 1) expect(await drain(ctx)).toEqual(chunks)
    expect(adapter.calls).toBe(3)
    await ctx.fiber.dispose()
  })
})
