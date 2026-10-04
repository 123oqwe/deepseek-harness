/**
 * CENSUS-1 (never merge): a keyless model route whose requests are never
 * answered, so the shipped headless runner's one-shot task stays in flight
 * while the boot's post-mount comparison runs and the driver reads the shadow
 * decisions. The driver disposes the tree afterwards.
 * @module tests/first100/fixtures/loader/p1-01-census/hang-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/** The route the driver passes to `--model`. */
export const CENSUS_ROUTE = 'p1-01-census-hang'

/** Never yields: the request stays pending until the process exits. */
class HangingAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await new Promise<never>(() => {})
  }
}

/** Plugin name. */
export const name = 'p1-01-census-hang-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the hanging adapter under the census route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([CENSUS_ROUTE], new HangingAdapter())
}
