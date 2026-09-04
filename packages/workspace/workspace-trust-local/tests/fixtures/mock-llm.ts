import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic one-step adapter: the P1-07 fixture observes the composed request, never the reply. */
class WorkspaceTrustMockAdapter extends LlmAdapter {
  async * stream(): AsyncIterable<StreamChunk> {
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'workspace-trust-mock-llm'
export const inject = ['llm']

/** Register the test-only `workspace-trust-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['workspace-trust-mock'], new WorkspaceTrustMockAdapter())
}
