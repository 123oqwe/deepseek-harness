import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * An adapter that answers every request with a fixed line.
 *
 * The model provider is the only thing this fixture mocks; the parent, the
 * subagent service that starts the child, and the Run Service are the rows the
 * shipped profile mounts.
 */
class FixedAdapter extends LlmAdapter {
  async * stream(): AsyncIterable<StreamChunk> {
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'p4-01-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `p4-01-mock` adapter.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['p4-01-mock'], new FixedAdapter())
}
