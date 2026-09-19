import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * Every text block of one message, concatenated.
 * @param message - the message to read.
 * @returns its text, empty when it carries none.
 */
function textOf(message: Message): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/**
 * The system prompt as this request carries it.
 *
 * **A loop-built request leaves `GenerateOptions.system` undefined** — the
 * declaration says so (`packages/llm/llm/src/types.ts:432-436`) and this
 * fixture drives a real agent-loop turn, so reading that field alone recorded
 * an empty string on both sides of the pair. The prompt travels as the leading
 * system-role message; `options.system` is kept for the one-shot shape.
 * @param options - the request the adapter was given.
 * @returns the system text, empty when this request carries none.
 */
function systemTextOf(options: GenerateOptions): string {
  if (options.system !== undefined && options.system !== '') return options.system
  const leading = options.messages.find(message => message.role === 'system')
  return leading === undefined ? '' : textOf(leading)
}

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
      // The system prompt as the model receives it, which is where a project's
      // own instructions arrive when the workspace is trusted. The two raw
      // readings and the roles travel with it so an empty result says WHICH
      // shape this request had rather than leaving the reader to guess.
      // The WHOLE request, message by message, not only the system slot.
      // `dsh-agent-instructions` folds a project's own content in as a
      // user-role message (`src/index.ts:190` builds a `UserMessage`, `:429-431`
      // splices it into the step's messages), so a reader that searched the
      // system prompt alone would call the boundary proven while the marker
      // travelled one message further down.
      writeFileSync('request.json', JSON.stringify({
        system: systemTextOf(options),
        systemOption: options.system ?? null,
        messages: options.messages.map((message, index) => ({ index, role: message.role, text: textOf(message) })),
      }), 'utf8')
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
