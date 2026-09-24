/**
 * Keyless scripted model for P4-05's waiting-state cases: a turn's opening
 * request is answered with one call to the third-party tool, the request after
 * its result with text, and a request made for another purpose (a session
 * title) with text, so it cannot consume the turn's tool call.
 * @module tests/first100/fixtures/loader/p4-05-waiting/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { PROVIDER, THIRD_PARTY_TOOL } from './shared.ts'
import type { AdapterGlobal } from './shared.ts'

let calls = 0

/**
 * One scripted model answer.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(`p4-05-waiting-${String(++calls)}`, THIRD_PARTY_TOOL, {}) : textResponse('done')
}

/** Plugin name. */
export const name = 'p4-05-waiting-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the overlay's route and publish it for the driver.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  const adapter = new MockAdapter(Array.from({ length: 16 }, () => answer))
  ;(globalThis as AdapterGlobal).__P4_05_WAITING_ADAPTER__ = adapter
  ctx.llm.registerAdapter([PROVIDER], adapter)
}
