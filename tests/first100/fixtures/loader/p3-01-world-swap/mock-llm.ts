/**
 * Keyless scripted model for P3-01's world-swap cases: a turn's opening
 * request is answered with one call of the shipped `read` tool on the file the
 * driver wrote, the request after its result with text, and a request made for
 * another purpose (a session title) with text, so it cannot consume the turn's
 * tool call.
 * @module tests/first100/fixtures/loader/p3-01-world-swap/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { CALL_ID, PROVIDER, READ_FILE } from './shared.ts'

/**
 * One scripted model answer.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(CALL_ID, 'read', { file_path: READ_FILE }) : textResponse('done')
}

/** Plugin name. */
export const name = 'p3-01-world-swap-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the overlay's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
}
