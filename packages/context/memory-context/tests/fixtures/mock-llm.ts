import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic one-step adapter for the memory-context Loader fixture. */
class MemoryContextMockAdapter extends LlmAdapter {
  /**
   * Whether the turn's request has already been recorded. The profile issues
   * more than one request per run — the session-title plugin makes its own —
   * and only the first is the turn the fixture drives.
   */
  private captured = false

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!this.captured) {
      this.captured = true
      // What the model reads, and only that: the system slot, each message's
      // role and content, and the tool schemas. `provider` and `model` are the
      // route; a message's `id` is a per-run uuid and its `source` is envelope
      // attribution. Recording those would make two runs of one composition
      // differ, which would say nothing about the memory switch.
      writeFileSync('request.json', JSON.stringify({
        system: options.system,
        messages: options.messages.map(message => ({ role: message.role, content: message.content })),
        tools: options.tools,
      }), 'utf8')
    }
    const text = 'memory recalled'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'memory-context-mock-llm'
export const inject = ['llm']

/**
 * Register the test-only `memory-context-mock` adapter.
 * @param ctx - plugin context; the registration is disposed with it.
 * @returns Nothing.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['memory-context-mock'], new MemoryContextMockAdapter())
}
