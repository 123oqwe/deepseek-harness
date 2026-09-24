/**
 * Keyless scripted model for A-379's measurement. A request's pending messages
 * are every message after its last assistant message; the model answers from
 * the turn marker they carry:
 *
 * - `A-379 TURN-1` and `A-379 TURN-3`: one `p4_05_probe` call;
 * - `A-379 TURN-2`: `p4_05_fail_run` and then `p4_05_probe`, in one step;
 * - a pending tool result, or anything else (a session title included): text.
 * @module tests/first100/fixtures/loader/p4-05-terminal/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's root agent names. */
const PROVIDER = 'p4-05-terminal-mock'
/** The tool that records that it ran. */
const PROBE_TOOL = 'p4_05_probe'
/** The tool that advances the calling agent's Run to `failed`. */
const FAIL_RUN_TOOL = 'p4_05_fail_run'

let calls = 0

/**
 * The chunks of one tool-call block.
 * @param index - the block's position in the response.
 * @param name - the tool to call.
 * @returns the block's chunks.
 */
function toolCallBlock(index: number, name: string): StreamChunk[] {
  const id = ToolCallId(`p4-05-terminal-${String(++calls)}`)
  return [
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id, name, argumentsDelta: '{}' },
    { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: '{}' } },
  ]
}

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
  if (text.includes('A-379 TURN-2')) {
    return [
      ...toolCallBlock(0, FAIL_RUN_TOOL),
      ...toolCallBlock(1, PROBE_TOOL),
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
  }
  if (text.includes('A-379 TURN-1') || text.includes('A-379 TURN-3')) {
    return toolCallResponse(`p4-05-terminal-${String(++calls)}`, PROBE_TOOL, {})
  }
  return textResponse('ok')
}

/** Plugin name. */
export const name = 'p4-05-terminal-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 32 }, () => answer)))
}
