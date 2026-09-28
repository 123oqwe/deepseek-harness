/**
 * Keyless scripted model for P4-06 acceptance[0]'s settlement crash-window
 * measurement, shared by the parent and the child.
 *
 * A request's pending messages are every message after its last assistant
 * message: a turn's prompt arrives together with the runtime-context message a
 * plugin appends after it, so the last message alone is not the prompt.
 *
 * - While `P4_06_HOLD` is `1`, a request whose pending user messages carry the
 *   hold marker stays open until the request's abort signal fires, and then
 *   ends. The driver sets it only for the process before the crash, so the
 *   child's first turn is in flight when the driver interrupts it; the interrupt
 *   drives the child to an `aborted` terminal, whose settlement is what the
 *   parent must ultimately receive exactly once across the crash.
 * - Every other request — a tool result, a settlement notice, a session title —
 *   is answered with text. The parent does not need to act on the notice; the
 *   measurement counts the notice reaching the parent's durable record.
 * @module tests/first100/fixtures/loader/p4-06-settlement-crash/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's agents name. */
const PROVIDER = 'p4-06-settlement-crash-mock'
/** The marker that makes the scripted model hold the child's first request open. */
const HOLD_MARKER = 'P4-06-HOLD'

/**
 * Reject once the request is cancelled, standing for a participant that stops
 * when it is told to.
 * @param signal - the request's abort signal.
 * @returns a promise that rejects when the signal aborts.
 */
function holdUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) return Promise.reject(new Error('p4-06 settlement-crash mock: a held request needs an abort signal'))
  return new Promise((_resolve, reject) => {
    const stop = (): void => { reject(new Error('aborted')) }
    if (signal.aborted) {
      stop()
      return
    }
    signal.addEventListener('abort', stop, { once: true })
  })
}

/**
 * The scripted answer to one request.
 * @param options - the request the loop sent.
 * @returns the chunks to stream, or `hold` for the child's held first request.
 */
function answer(options: GenerateOptions): StreamChunk[] | 'hold' {
  if (options.purpose !== undefined) return textResponse('ok')
  const pending = options.messages.slice(options.messages.findLastIndex(message => message.role === 'assistant') + 1)
  const text = pending
    .filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n')
  if (process.env.P4_06_HOLD === '1' && text.includes(HOLD_MARKER)) return 'hold'
  return textResponse('ok')
}

/** Streams the scripted answer, or holds the child's first request until it is cancelled. */
class SettlementCrashAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const chunks = answer(options)
    if (chunks === 'hold') {
      await holdUntilAborted(options.signal)
      return
    }
    yield* chunks
  }
}

/** Plugin name. */
export const name = 'p4-06-settlement-crash-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new SettlementCrashAdapter())
}
