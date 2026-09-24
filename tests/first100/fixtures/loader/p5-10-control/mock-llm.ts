/**
 * Keyless model for P5-10's shipped-composition cases: every request, the
 * parent's and the child's alike, is answered with the same short text, so a
 * turn ends after one step and the only thing that opens a turn is a message
 * reaching an agent's inbox.
 * @module tests/first100/fixtures/loader/p5-10-control/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Streams one fixed text block and stops. */
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

/** Plugin name. */
export const name = 'p5-10-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the fixed-text adapter under provider `p5-10-mock`.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['p5-10-mock'], new FixedAdapter())
}
