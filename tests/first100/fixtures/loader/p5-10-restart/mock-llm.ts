/**
 * Keyless scripted model for P5-10 question 13's measurement, shared by the
 * parent and the child.
 *
 * A request's pending messages are every message after its last assistant
 * message: a turn's prompt arrives together with the runtime-context message a
 * plugin appends after it, so the last message alone is not the prompt.
 *
 * - While `P5_10_HOLD` is `1`, a request whose pending user messages carry the
 *   hold marker stays open until the request's abort signal fires, and ends
 *   `P5_10_ABORT_DELAY_MS` milliseconds after it (default 0), which stands for
 *   a participant that is slow to stop. The driver sets both only for the
 *   process before the restart, so the child's first turn is in flight when
 *   the driver cancels it.
 * - When `P5_10_PARENT_CONTINUES` is `1`, a request whose pending user messages
 *   carry a subagent settlement notice ("Background subagent <id> was stopped
 *   before it finished.") is answered with one `send_message` call to that
 *   child.
 * - A request whose pending messages carry a tool result, and every other
 *   request, a session title included, is answered with text.
 * @module tests/first100/fixtures/loader/p5-10-restart/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's agents name. */
const PROVIDER = 'p5-10-restart-mock'
/** The marker the driver puts in the child's first prompt. */
const HOLD_MARKER = 'P5-10-HOLD'
/** The message the parent sends its child when it continues it. */
const CARRY_ON = 'P5-10: carry on after the restart.'
/** The notice `createSettlementMessage` builds for a child stopped before it finished. */
const STOPPED_NOTICE = /Background subagent (?<child>\S+) was stopped before it finished\./u

let calls = 0

/**
 * Wait until the request is cancelled, and then for `delayMs` more.
 * @param signal - the request's abort signal.
 * @param delayMs - how long the request takes to end once cancelled.
 * @returns a promise that rejects `delayMs` after the signal aborts.
 */
function holdUntilAborted(signal: AbortSignal | undefined, delayMs: number): Promise<never> {
  if (signal === undefined) return Promise.reject(new Error('p5-10 restart mock: a held request needs an abort signal'))
  return new Promise((_resolve, reject) => {
    const stop = (): void => { setTimeout(() => { reject(new Error('aborted')) }, delayMs) }
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
 * @returns the chunks to stream, or `hold` for a request that waits for its cancellation.
 */
function answer(options: GenerateOptions): StreamChunk[] | 'hold' {
  if (options.purpose !== undefined) return textResponse('ok')
  const pending = options.messages.slice(options.messages.findLastIndex(message => message.role === 'assistant') + 1)
  if (pending.some(message => message.content.some(block => block.type === 'tool-result'))) return textResponse('done')
  const text = pending
    .filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n')
  if (process.env.P5_10_HOLD === '1' && text.includes(HOLD_MARKER)) return 'hold'
  const child = STOPPED_NOTICE.exec(text)?.groups?.child
  if (child !== undefined && process.env.P5_10_PARENT_CONTINUES === '1') {
    return toolCallResponse(`p5-10-restart-${String(++calls)}`, 'send_message', { agent_id: child, message: CARRY_ON })
  }
  return textResponse('ok')
}

/** Streams the scripted answer, or holds until the request is cancelled. */
class RestartAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const chunks = answer(options)
    if (chunks === 'hold') {
      await holdUntilAborted(options.signal, Number(process.env.P5_10_ABORT_DELAY_MS ?? '0'))
      return
    }
    yield* chunks
  }
}

/** Plugin name. */
export const name = 'p5-10-restart-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new RestartAdapter())
}
