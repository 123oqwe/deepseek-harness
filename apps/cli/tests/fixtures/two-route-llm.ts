/**
 * Two keyless adapter routes for Epic P9-03's `--model` real-composition test.
 *
 * Two rather than one, because the property under test is a CHOICE. With a
 * single registered route the run reaches it no matter what `--model` does, and
 * the test would pass against a build that ignored the flag entirely.
 *
 * Each route answers with its own name, so the reply alone says which one ran —
 * an assertion that cannot be satisfied by the wrong route.
 *
 * @module apps/cli/tests/fixtures/two-route-llm
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

/** The routes this fixture registers; the test names them in its `--model` argument. */
export const P9_03_ROUTES = ['p9-mock-a', 'p9-mock-b']

/** Answers with the route and model it was reached on, and calls no tool. */
class RouteEchoAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reply = `ROUTE=${options.provider} MODEL=${options.model}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'p9-03-two-route-llm'
export const inject = ['llm']

/**
 * Register both keyless routes on one adapter.
 * @param ctx - plugin context carrying the llm registry.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([...P9_03_ROUTES], new RouteEchoAdapter())
}
