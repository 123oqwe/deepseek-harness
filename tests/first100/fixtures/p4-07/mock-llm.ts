import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** The one tool call a tool turn asks for. */
const TODO_CALL = ToolCallId('p4-07-todo')

/** The first line of a task that asks for one `todo_write` call before answering. */
export const TOOL_TURN = 'P4-07 tool turn'

/**
 * An adapter for P4-07's shipped-profile cases.
 *
 * A conversation request whose task starts with {@link TOOL_TURN} and has no
 * result for {@link TODO_CALL} yet gets one `todo_write` call; every other
 * request gets the text `ok`. The model provider is the only thing this
 * fixture mocks.
 */
class P407Adapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const task = options.messages.some(message => message.role === 'user' && message.content.some(block =>
      block.type === 'text' && block.text.startsWith(TOOL_TURN)))
    const answered = options.messages.some(message => message.content.some(block =>
      block.type === 'tool-result' && block.toolCallId === TODO_CALL))
    if (options.purpose === undefined && task && !answered) {
      const args = JSON.stringify({ todos: [{ content: 'p4-07 probe', status: 'pending' }] })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: TODO_CALL, name: 'todo_write', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'p4-07-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `p4-07-mock` adapter.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['p4-07-mock'], new P407Adapter())
}
