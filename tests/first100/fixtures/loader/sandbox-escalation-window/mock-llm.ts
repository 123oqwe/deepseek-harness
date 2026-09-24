/**
 * Keyless scripted model for BLOCKED-334's fourth site. In the turn whose
 * pending user text carries `A-392` the model calls `bash` twice in turn:
 * first a confined `echo`, which shows whether the platform's sandbox runner
 * works, then a command that writes a marker file, asking to escalate to
 * `danger-full-access`. The request after the second result, and every other
 * request (a session title included), is answered with text.
 * @module tests/first100/fixtures/loader/sandbox-escalation-window/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's root agent names. */
const PROVIDER = 'sandbox-escalation-window-mock'
/** The file the escalated command writes, relative to the session's working directory. */
const MARKER_FILE = 'a392-marker.txt'

/** How many of the turn's two bash calls the model has made. */
let calls = 0

/**
 * One scripted model answer.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const pending = options.messages.slice(options.messages.findLastIndex(message => message.role === 'assistant') + 1)
  const toolResult = pending.some(message => message.content.some(block => block.type === 'tool-result'))
  const text = pending
    .filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n')
  if (!toolResult && text.includes('A-392') && calls === 0) {
    calls = 1
    return toolCallResponse('a392-confined', 'bash', { command: 'echo confined-ok', description: 'check that the sandbox runner works' })
  }
  if (toolResult && calls === 1) {
    calls = 2
    return toolCallResponse('a392-escalated', 'bash', {
      command: `echo ran > ${MARKER_FILE}`,
      description: 'write the marker file',
      sandbox_permissions: 'danger-full-access',
      justification: 'A-392 measures what an approved escalation does after its Run was fenced or stopped',
    })
  }
  return textResponse(toolResult ? 'done' : 'ok')
}

/** Plugin name. */
export const name = 'sandbox-escalation-window-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
}
