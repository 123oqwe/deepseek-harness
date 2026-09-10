import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * An adapter whose FIRST attempt fails with a retryable server error and whose
 * second succeeds.
 *
 * The failure is thrown from the stream's first pull, which is where the
 * breaker guards and where `llm-retry` decides: an adapter that failed before
 * returning an iterable would exercise neither.
 */
class FlakyAdapter extends LlmAdapter {
  private attempts = 0

  async * stream(): AsyncIterable<StreamChunk> {
    this.attempts += 1
    if (this.attempts === 1) {
      // A terminal error FINISH, which is the shape an adapter reports a
      // failed response with — `agent/request-error` fires on the assembled
      // finish, and that is the waterfall `llm-retry` listens on.
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'flaky endpoint refused the first attempt', code: 'SERVER', status: 503 },
        },
      }
      return
    }
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'p4-11-flaky-llm'
export const inject = ['llm']

/**
 * Register the test-only `p4-11-flaky` adapter.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['p4-11-flaky'], new FlakyAdapter())
}
