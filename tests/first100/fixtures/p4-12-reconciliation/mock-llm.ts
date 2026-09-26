import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * A trivial keyless adapter for P4-12's reconciliation cases.
 *
 * The driver creates one agent only so it has a command receiver whose
 * identity is the host user; it never runs a turn, so this adapter answers
 * every request with the text `ok`. The model provider is the only thing this
 * fixture mocks.
 */
class P412Adapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'p4-12-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `p4-12-mock` adapter.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['p4-12-mock'], new P412Adapter())
}
