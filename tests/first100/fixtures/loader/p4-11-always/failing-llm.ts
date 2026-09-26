/**
 * An adapter whose route carries the `always` retry policy and whose FIRST
 * conversation attempt fails, for A-457 under P4-11 acceptance[0].
 * `A457_FAILURE` names the failure: `retryable` (`SERVER`, 503),
 * `invalid-request-400` (`INVALID_REQUEST`, 400, as the shipped DeepSeek
 * adapter maps an HTTP 400) or `invalid-request` (`INVALID_REQUEST` with no
 * status, as an adapter refuses a request before sending it). Later attempts
 * succeed, so a retry ends the turn. A request made for another purpose (a
 * session title) is answered with text and is not an attempt; conversation
 * attempts are counted on `globalThis.__a457Attempts`, which the driver in the
 * same process reads.
 *
 * The failure is a terminal error finish, as in A-418c's adapter:
 * `agent/request-error` fires on the assembled finish, and that is the
 * waterfall `llm-retry` decides on.
 * @module tests/first100/fixtures/loader/p4-11-always/failing-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, resolveRetryPolicy, type GenerateOptions, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** The failure each `A457_FAILURE` value names. */
const FAILURES: Readonly<Record<string, { readonly code: string; readonly status?: number }>> = {
  'retryable': { code: 'SERVER', status: 503 },
  'invalid-request-400': { code: 'INVALID_REQUEST', status: 400 },
  'invalid-request': { code: 'INVALID_REQUEST' },
}

/** The provider route this adapter serves. */
const PROVIDER = 'a457-failing'

class AlwaysFailingAdapter extends LlmAdapter {
  /** This route's retry policy: `always`, with a one-millisecond backoff so a retry does not slow the case. */
  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'always', backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }, `llm: provider "${PROVIDER}" retryPolicy`)
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const counter = globalThis as { __a457Attempts?: number }
    if (options.purpose === undefined) counter.__a457Attempts = (counter.__a457Attempts ?? 0) + 1
    if (options.purpose === undefined && counter.__a457Attempts === 1) {
      const kind = process.env.A457_FAILURE ?? ''
      const failure = FAILURES[kind]
      if (failure === undefined) throw new Error(`A457_FAILURE must be one of ${Object.keys(FAILURES).join(', ')}, got "${kind}"`)
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: `a457 first attempt fails (${kind})`,
            code: failure.code,
            ...failure.status === undefined ? {} : { status: failure.status },
          },
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

/** Plugin name. */
export const name = 'a457-failing-llm'
/** Services this plugin needs. */
export const inject = ['llm']

/**
 * Register the test-only `a457-failing` adapter.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new AlwaysFailingAdapter())
}
