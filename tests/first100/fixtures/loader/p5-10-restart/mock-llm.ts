/**
 * Keyless scripted model for P5-10 question 13's measurement, shared by the
 * parent and the child.
 *
 * - A request whose last message is a user message carrying the hold marker
 *   stays open until the request's abort signal fires, so the child's first
 *   turn is in flight when the driver cancels it.
 * - When `P5_10_PARENT_CONTINUES` is `1`, a request whose last message is a
 *   subagent settlement notice ("Background subagent <id> was stopped before
 *   it finished.") is answered with one `send_message` call to that child.
 * - Every other request, a session title included, is answered with text.
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
 * Wait until the request is cancelled.
 * @param signal - the request's abort signal.
 * @returns a promise that rejects once the signal aborts.
 */
function holdUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) return Promise.reject(new Error('p5-10 restart mock: a held request needs an abort signal'))
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
  })
}

/**
 * The scripted answer to one request.
 * @param options - the request the loop sent.
 * @returns the chunks to stream, or `hold` for a request that waits for its cancellation.
 */
function answer(options: GenerateOptions): StreamChunk[] | 'hold' {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  if (last?.role !== 'user' || last.content.some(block => block.type === 'tool-result')) return textResponse('done')
  const text = last.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  if (text.includes(HOLD_MARKER)) return 'hold'
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
      await holdUntilAborted(options.signal)
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
