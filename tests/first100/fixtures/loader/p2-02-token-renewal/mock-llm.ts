/**
 * Keyless scripted model for BLOCKED-331's cases, shared by the root agent
 * and its children.
 *
 * A request's pending messages are every message after its last assistant
 * message. A pending tool result is answered with text. Otherwise the pending
 * user text decides:
 *
 * - `A-390-CHILD-LATE`: after {@link LATE_MS}, one probe call, so the child's
 *   token has expired by the time the call presents it;
 * - `A-390-CHILD`: one probe call at once;
 * - `A-390-PROBE`: one probe call, or in code mode (`DSH_TOOLS_MODE=ptc`) one
 *   `run_code` call whose program waits {@link LATE_MS}, calls the probe, and
 *   returns the outcome prefixed with `A390-RAN: `;
 * - anything else, a session title included: text.
 * @module tests/first100/fixtures/loader/p2-02-token-renewal/mock-llm
 */

import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'

/** The route the driver's agents name. */
const PROVIDER = 'p2-02-token-renewal-mock'
/** The probe tool the driver registers. */
const PROBE_TOOL = 'a390_probe'
/** How long a late call waits: past the overlay's 1500 ms session-token TTL. */
const LATE_MS = 2_000

/** The code-mode program: wait past the TTL, make one probe call, and return its outcome. */
const PROGRAM = [
  `await new Promise(resolve => setTimeout(resolve, ${String(LATE_MS)}))`,
  'try {',
  `  await tools.${PROBE_TOOL}({})`,
  "  return 'A390-RAN: probe tool ran'",
  '} catch (error) {',
  "  return 'A390-RAN: ' + (error instanceof Error ? error.message : String(error))",
  '}',
].join('\n')

let calls = 0

/**
 * The scripted answer to one request.
 * @param options - the request the loop sent.
 * @returns the chunks to stream, and how long to wait before streaming them.
 */
function answer(options: GenerateOptions): { readonly chunks: StreamChunk[]; readonly waitMs: number } {
  if (options.purpose !== undefined) return { chunks: textResponse('ok'), waitMs: 0 }
  const pending = options.messages.slice(options.messages.findLastIndex(message => message.role === 'assistant') + 1)
  if (pending.some(message => message.content.some(block => block.type === 'tool-result'))) return { chunks: textResponse('done'), waitMs: 0 }
  const text = pending
    .filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n')
  const id = `p2-02-token-renewal-${String(++calls)}`
  if (text.includes('A-390-CHILD-LATE')) return { chunks: toolCallResponse(id, PROBE_TOOL, {}), waitMs: LATE_MS }
  if (text.includes('A-390-CHILD')) return { chunks: toolCallResponse(id, PROBE_TOOL, {}), waitMs: 0 }
  if (!text.includes('A-390-PROBE')) return { chunks: textResponse('ok'), waitMs: 0 }
  return {
    chunks: process.env.DSH_TOOLS_MODE === 'ptc'
      ? toolCallResponse(id, 'run_code', { code: PROGRAM, description: 'call the probe after the session token has expired' })
      : toolCallResponse(id, PROBE_TOOL, {}),
    waitMs: 0,
  }
}

/** Streams the scripted answer, after the wait it names. */
class RenewalAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { chunks, waitMs } = answer(options)
    if (waitMs > 0) await delay(waitMs)
    yield* chunks
  }
}

/** Plugin name. */
export const name = 'p2-02-token-renewal-mock-llm'

/** The LLM service registers the adapter. */
export const inject = ['llm']

/**
 * Register the scripted adapter under the driver's route.
 * @param ctx - plugin context with the LLM service.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new RenewalAdapter())
}
