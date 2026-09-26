import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * A trivial keyless adapter for P4-05 acceptance[2]'s reclaim-after-restart
 * observation. The driver creates one agent per phase only so a Run is opened
 * and a lease acquired; it never runs a turn, so this adapter answers every
 * request with the text `ok`. The model provider is the only thing this fixture
 * mocks — the lease store and Run store are the shipped durable ones.
 * @module tests/first100/fixtures/loader/p4-05-reclaim/mock-llm
 */
class P405ReclaimAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'p4-05-reclaim-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `p4-05-reclaim-mock` adapter.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['p4-05-reclaim-mock'], new P405ReclaimAdapter())
}
