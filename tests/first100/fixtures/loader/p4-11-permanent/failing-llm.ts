import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * An adapter whose FIRST conversation attempt fails and whose later attempts
 * succeed, for BLOCKED-281 (b). `A418_FAILURE` names the failure: `retryable`
 * (`SERVER`, 503), `invalid-request` (`INVALID_REQUEST`, 400) or `auth` (`AUTH`,
 * 403). A request made for another purpose (a session title) is answered with
 * text and is not an attempt: A-418b read the shipped `session-title-llm` row
 * sending one through this adapter. Conversation attempts are counted on
 * `globalThis.__a418Attempts`, and every call is recorded on
 * `globalThis.__a418Calls` (its purpose, milliseconds since the first call, and
 * the first stack frames), which the driver in the same process reads.
 *
 * The failure is a terminal error finish, as in the P4-11 mount slice's
 * `flaky-llm.ts`: `agent/request-error` fires on the assembled finish, and that
 * is the waterfall `llm-retry` decides on.
 * @module tests/first100/fixtures/loader/p4-11-permanent/failing-llm
 */

/** The failure each `A418_FAILURE` value names. */
const FAILURES = {
  'retryable': { code: 'SERVER', status: 503 },
  'invalid-request': { code: 'INVALID_REQUEST', status: 400 },
  'auth': { code: 'AUTH', status: 403 },
} as const

/** One recorded call. */
interface CallRecord { readonly i: number, readonly purpose: string, readonly atMs: number, readonly frames: readonly string[] }

/** The process-global attempt counter and call record the driver reads. */
interface AttemptCounter { __a418Attempts?: number, __a418Calls?: CallRecord[], __a418FirstAt?: number }

/** Repository path prefix removed from recorded stack frames. */
const REPO_PREFIX = /\(?(?:file:\/\/)?\/[^()]*?deepseek-harness\//gu

class FailingAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const counter = globalThis as AttemptCounter
    const now = Date.now()
    counter.__a418FirstAt ??= now
    const frames = (new Error('a418 call').stack ?? '').split('\n').slice(2, 8).map(frame => frame.trim().replace(REPO_PREFIX, '').slice(0, 160))
    const calls = (counter.__a418Calls ??= [])
    calls.push({ i: calls.length + 1, purpose: options.purpose ?? 'turn', atMs: now - counter.__a418FirstAt, frames })
    if (options.purpose === undefined) counter.__a418Attempts = (counter.__a418Attempts ?? 0) + 1
    if (options.purpose === undefined && counter.__a418Attempts === 1) {
      const kind = process.env.A418_FAILURE ?? ''
      if (!Object.hasOwn(FAILURES, kind)) throw new Error(`A418_FAILURE must be one of ${Object.keys(FAILURES).join(', ')}, got "${kind}"`)
      const failure = FAILURES[kind as keyof typeof FAILURES]
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: `a418 first attempt fails (${kind})`, code: failure.code, status: failure.status } },
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
export const name = 'a418-failing-llm'
/** Services this plugin needs. */
export const inject = ['llm']

/**
 * Register the test-only `a418-failing` adapter.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['a418-failing'], new FailingAdapter())
}
