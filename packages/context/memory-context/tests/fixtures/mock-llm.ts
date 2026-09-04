import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic one-step adapter for the memory-context Loader fixture. */
class MemoryContextMockAdapter extends LlmAdapter {
  async * stream(): AsyncIterable<StreamChunk> {
    const text = 'memory recalled'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'memory-context-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `memory-context-mock` adapter.
 * @param ctx - plugin context; the registration is disposed with it.
 * @returns Nothing.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['memory-context-mock'], new MemoryContextMockAdapter())
}
