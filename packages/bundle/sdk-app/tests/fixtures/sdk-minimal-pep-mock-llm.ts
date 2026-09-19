/**
 * The model for BLOCKED-266's observation: one tool call, then a stop.
 *
 * A tool call and not text, because the question is what happens to an ACTION
 * on `sdk-minimal` — whether a policy decision is taken, what it says, and
 * whether the tool body runs. A text-only turn reaches none of that.
 *
 * Deterministic and self-limiting: the first request asks for exactly one call
 * to the harmless probe tool, and every later request stops. A model that kept
 * asking would turn an observation into a loop.
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** The tool the probe asks for; the driver registers one by this name. */
export const PEP_PROBE_TOOL = 'pep_probe'

/** Deterministic adapter: call the probe once, then stop. */
class SdkMinimalPepMockAdapter extends LlmAdapter {
  /** Whether the one tool call has already been asked for. */
  private asked = false

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!this.asked) {
      this.asked = true
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: ToolCallId('pep-probe-1'), name: PEP_PROBE_TOOL, arguments: '{}' },
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = 'done'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'sdk-minimal-pep-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `sdk-minimal-pep-mock` adapter.
 * @param ctx - plugin context; the registration is disposed with it.
 * @returns Nothing.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['sdk-minimal-pep-mock'], new SdkMinimalPepMockAdapter())
}
