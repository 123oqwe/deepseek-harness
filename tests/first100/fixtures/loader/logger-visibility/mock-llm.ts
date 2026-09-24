/**
 * Keyless scripted model for A-391's measurement: a turn's opening request is
 * answered with one probe call, the request after its result with text, and a
 * request made for another purpose (a session title) with text.
 * @module tests/first100/fixtures/loader/logger-visibility/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's root agent names. */
const PROVIDER = 'logger-visibility-mock'
/** The probe tool the driver registers. */
const PROBE_TOOL = 'a391_probe'

let calls = 0

/**
 * One scripted model answer.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const pending = options.messages.slice(options.messages.findLastIndex(message => message.role === 'assistant') + 1)
  if (pending.some(message => message.content.some(block => block.type === 'tool-result'))) return textResponse('done')
  return toolCallResponse(`logger-visibility-${String(++calls)}`, PROBE_TOOL, {})
}

/** Plugin name. */
export const name = 'logger-visibility-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
}
