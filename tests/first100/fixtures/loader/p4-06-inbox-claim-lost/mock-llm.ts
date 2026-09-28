/**
 * Keyless scripted model for P4-06 lock (a)'s claim-before-record measurement:
 * every request is answered with text, so a turn that is NOT rejected in
 * pre-step completes and records its claimed user message. A turn whose
 * pre-step rejects never reaches the model.
 * @module tests/first100/fixtures/loader/p4-06-inbox-claim-lost/mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's agent names. */
const PROVIDER = 'p4-06-inbox-claim-lost-mock'

/** Streams a plain text answer to every request. */
class ClaimLostAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await Promise.resolve()
    yield* textResponse('ok')
  }
}

/** Plugin name. */
export const name = 'p4-06-inbox-claim-lost-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new ClaimLostAdapter())
}
