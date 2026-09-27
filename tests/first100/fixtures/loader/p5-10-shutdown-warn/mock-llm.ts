/**
 * Keyless scripted model for A-537 (BLOCKED-333 latter half): the parent's
 * turn is answered with text, and the child's first request carries the hold
 * marker and stays open until its abort signal fires, then ends
 * `A537_ABORT_DELAY_MS` milliseconds later — so the child is still resident and
 * cancelling when the driver disposes the tree.
 * @module tests/first100/fixtures/loader/p5-10-shutdown-warn/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's agents name. */
const PROVIDER = 'p5-10-shutdown-warn-mock'
/** The marker the driver puts in the child's first prompt. */
const HOLD_MARKER = 'A537-HOLD'

/**
 * Reject once the request is cancelled, and then `delayMs` later.
 * @param signal - the request's abort signal.
 * @param delayMs - how long the request takes to end once cancelled.
 * @returns a promise that rejects `delayMs` after the signal aborts.
 */
function holdUntilAborted(signal: AbortSignal | undefined, delayMs: number): Promise<never> {
  if (signal === undefined) return Promise.reject(new Error('a537 mock: a held request needs an abort signal'))
  return new Promise((_resolve, reject) => {
    const stop = (): void => { setTimeout(() => { reject(new Error('aborted')) }, delayMs) }
    if (signal.aborted) {
      stop()
      return
    }
    signal.addEventListener('abort', stop, { once: true })
  })
}

/** The pending user text of one request: every message after the last assistant message. */
function pendingUserText(options: GenerateOptions): string {
  const pending = options.messages.slice(options.messages.findLastIndex(message => message.role === 'assistant') + 1)
  return pending
    .filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n')
}

/** Streams `ok`, or holds a request carrying the hold marker until it is cancelled. */
class ShutdownWarnAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === undefined && pendingUserText(options).includes(HOLD_MARKER)) {
      await holdUntilAborted(options.signal, Number(process.env.A537_ABORT_DELAY_MS ?? '0'))
      return
    }
    yield* textResponse('ok')
  }
}

/** Plugin name. */
export const name = 'p5-10-shutdown-warn-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new ShutdownWarnAdapter())
}
