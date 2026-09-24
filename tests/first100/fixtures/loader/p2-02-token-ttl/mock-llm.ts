/**
 * Keyless scripted model for BLOCKED-331's measurement: every turn's opening
 * request is answered with one call of the probe tool, the request after its
 * result with text, and a request made for another purpose (a session title)
 * with text.
 * @module tests/first100/fixtures/loader/p2-02-token-ttl/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's root agent names. */
const PROVIDER = 'p2-02-token-ttl-mock'

/** The probe tool the driver registers. */
const PROBE_TOOL = 'p2_02_probe'

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
  return opensTurn ? toolCallResponse(`p2-02-token-ttl-${String(++calls)}`, PROBE_TOOL, {}) : textResponse('done')
}

/** Plugin name. */
export const name = 'p2-02-token-ttl-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 32 }, () => answer)))
}
