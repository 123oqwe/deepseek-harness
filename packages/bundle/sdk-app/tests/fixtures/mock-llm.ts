import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic one-step adapter that records the first request's system prompt. */
class WorkspaceTrustMockAdapter extends LlmAdapter {
  /**
   * Whether the turn's request has already been recorded. A profile issues
   * more than one request per run, and only the first is the turn this
   * fixture drives.
   */
  private captured = false

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!this.captured) {
      this.captured = true
      // The system slot as the model receives it, which is where a project's
      // own instructions arrive when the workspace is trusted. Nothing else is
      // recorded: message ids and sources differ between runs of one
      // composition and would say nothing about the trust boundary.
      writeFileSync('request.json', JSON.stringify({ system: options.system }), 'utf8')
    }
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'sdk-app-workspace-trust-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `sdk-trust-mock` adapter.
 * @param ctx - plugin context; the registration is disposed with it.
 * @returns Nothing.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['sdk-trust-mock'], new WorkspaceTrustMockAdapter())
}
