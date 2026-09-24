/**
 * Keyless scripted model for A-385's measurement and BLOCKED-334's cases. A
 * request's pending messages are every message after its last assistant
 * message; a turn whose pending user messages carry `A-385` is answered with
 * one `p4_07_probe` call, or in code mode (`DSH_TOOLS_MODE=ptc`) with one
 * `run_code` call whose program makes that call and returns its outcome; a
 * pending tool result, and anything else (a session title included), is
 * answered with text.
 * @module tests/first100/fixtures/loader/p4-07-ask-window/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's root agent names. */
const PROVIDER = 'p4-07-ask-window-mock'
/** The probe tool the driver registers. */
const PROBE_TOOL = 'p4_07_probe'

let calls = 0

/** The code-mode program: one probe call, returning the refusal's message when the call is refused. */
const PROGRAM = [
  'try {',
  `  await tools.${PROBE_TOOL}({})`,
  "  return 'probe tool ran'",
  '} catch (error) {',
  '  return error instanceof Error ? error.message : String(error)',
  '}',
].join('\n')

/**
 * One scripted model answer.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const pending = options.messages.slice(options.messages.findLastIndex(message => message.role === 'assistant') + 1)
  if (pending.some(message => message.content.some(block => block.type === 'tool-result'))) return textResponse('done')
  const text = pending
    .filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n')
  if (!text.includes('A-385')) return textResponse('ok')
  const id = `p4-07-ask-window-${String(++calls)}`
  return process.env.DSH_TOOLS_MODE === 'ptc'
    ? toolCallResponse(id, 'run_code', { code: PROGRAM, description: 'call the probe once' })
    : toolCallResponse(id, PROBE_TOOL, {})
}

/** Plugin name. */
export const name = 'p4-07-ask-window-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
}
