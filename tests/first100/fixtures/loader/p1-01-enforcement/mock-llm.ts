/**
 * Keyless scripted model for the P1-01 shipped-layer enforcement composition: a
 * turn's opening request is answered with one call of the base layer's `bash`
 * tool, the request after its result with text, and a request made for another
 * purpose (e.g. a session title) with text so it cannot consume the turn's tool
 * call. Whether that `bash` call runs or errors "unknown tool" is how the spec
 * reads that the base layer stayed or was denied.
 * @module tests/first100/fixtures/loader/p1-01-enforcement/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { BASE_TOOL, BASE_TOOL_COMMAND, CALL_ID, PROVIDER } from './shared.ts'

/**
 * One scripted model answer.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(CALL_ID, BASE_TOOL, { command: BASE_TOOL_COMMAND }) : textResponse('done')
}

/** Plugin name. */
export const name = 'p1-01-enforcement-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the overlay's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
}
