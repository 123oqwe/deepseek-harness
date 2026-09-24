import type { Context } from '@deepseek-ai/cordis'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  LlmAdapter,
  resolveRetryPolicy,
  type GenerateOptions,
  type LlmFailure,
  type Message,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/**
 * The first line of every scripted task: the turn, then the outcome of each
 * conversation request that turn makes, in order (`SERVER`, `OVERFLOW`,
 * `INVALID`, `AUTH`, `OK`).
 */
const SCRIPT_LINE = /^P4-11 turn (?<turn>\d+): (?<outcomes>[A-Z ]+)$/mu

/** A retryable endpoint failure whose provider-requested wait keeps `llm-retry`'s backoff at 1 ms. */
const SERVER_FAILURE: LlmFailure = {
  message: 'p4-11 scripted endpoint failure',
  code: 'SERVER',
  status: 503,
  providerRetryAfterMs: 1,
}

/** A provider-confirmed context overflow: `compaction-basic` recovers from it and `llm-retry` does not retry it. */
const OVERFLOW_FAILURE: LlmFailure = {
  message: 'p4-11 scripted context overflow',
  code: CONTEXT_WINDOW_EXCEEDED_CODE,
  status: 400,
}

/** A request the provider rejects as written: permanent, so no layer retries it. */
const INVALID_FAILURE: LlmFailure = {
  message: 'p4-11 scripted invalid request',
  code: 'INVALID_REQUEST',
  status: 400,
}

/** A rejected credential, the code `llm-deepseek` gives a 401 or 403: permanent as well. */
const AUTH_FAILURE: LlmFailure = {
  message: 'p4-11 scripted authentication failure',
  code: 'AUTH',
  status: 401,
}

/**
 * Answer one request with text, in the chunk sequence a successful stream
 * reports.
 * @param text - the whole answer.
 * @yields one text block, its usage, and a normal finish.
 */
function * answer(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * The script the newest scripted task carries.
 * @param messages - the request's messages; a runtime-context snapshot may follow the task.
 * @returns the turn label and its outcomes.
 */
function scriptOf(messages: readonly Message[]): { readonly turn: string; readonly outcomes: readonly string[] } {
  for (const message of messages.toReversed()) {
    if (message.role !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      const groups = SCRIPT_LINE.exec(block.text)?.groups
      if (groups?.turn !== undefined && groups.outcomes !== undefined) {
        return { turn: groups.turn, outcomes: groups.outcomes.split(' ') }
      }
    }
  }
  throw new Error('p4-11 scripted adapter: the request carries no scripted task')
}

/**
 * An adapter that answers each conversation request from the script in the
 * newest scripted task, and each auxiliary request — a compaction summary, a
 * session title — with text.
 *
 * Outcomes are indexed per turn rather than by call order, so neither a
 * summary request nor a resend the product declined to make shifts what a
 * later request receives. A request beyond its turn's script fails with a code
 * no layer retries, so an unplanned request shows in the reading.
 *
 * Failures are the terminal finish of the stream's first pull, the shape an
 * adapter reports a failed response with and the one `agent/request-error`
 * fires on.
 */
class ScriptedAdapter extends LlmAdapter {
  private readonly served = new Map<string, number>()

  /**
   * The route's own resolved policy, as the shipped adapters return theirs
   * (`llm-deepseek` resolves its configured `retryPolicy` the same way), rather
   * than the registry's fallback for an adapter that declares none.
   * @param provider - the route the policy is captured for.
   * @returns the default normal-mode policy.
   */
  override providerRetryPolicy(provider: string): ResolvedRetryPolicy {
    return resolveRetryPolicy(undefined, `p4-11 scripted provider "${provider}" retryPolicy`)
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose !== undefined) {
      yield * answer(options.purpose === 'compaction' ? 'summary' : 'p4-11 title')
      return
    }
    const script = scriptOf(options.messages)
    const index = this.served.get(script.turn) ?? 0
    this.served.set(script.turn, index + 1)
    const outcome = script.outcomes[index]
    switch (outcome) {
      case 'SERVER':
        yield { type: 'finish', reason: { kind: 'error', failure: SERVER_FAILURE } }
        return
      case 'OVERFLOW':
        yield { type: 'finish', reason: { kind: 'error', failure: OVERFLOW_FAILURE } }
        return
      case 'INVALID':
        yield { type: 'finish', reason: { kind: 'error', failure: INVALID_FAILURE } }
        return
      case 'AUTH':
        yield { type: 'finish', reason: { kind: 'error', failure: AUTH_FAILURE } }
        return
      case 'OK':
        yield * answer('ok')
        return
      default:
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: `p4-11 turn ${script.turn} scripts no request ${index + 1}`, code: 'P4_11_UNSCRIPTED', status: 400 },
          },
        }
    }
  }
}

export const name = 'p4-11-scripted-llm'
export const inject = ['llm']

/**
 * Register the test-only `p4-11-scripted` adapter.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['p4-11-scripted'], new ScriptedAdapter())
}
