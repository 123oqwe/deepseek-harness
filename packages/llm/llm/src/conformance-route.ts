/**
 * A scripted route the conformance kit can drive (Epic P9-01, Provider stage).
 *
 * The kit needs a subject that can be made to misbehave on demand: a real
 * provider cannot be asked to fail its next request, and a route that only ever
 * succeeds cannot show what it does when it cannot. This produces streams for
 * each scenario, with each behaviour independently breakable, so the kit's own
 * probes can be shown to catch a route that gets that behaviour wrong.
 *
 * It is not a wire-protocol mock. It emits `StreamChunk`s directly, which is
 * the surface `LlmAdapter.stream` is defined in; putting HTTP underneath would
 * test the transport rather than the adapter contract, and the three pi-ai
 * protocol routes each have their own transport already.
 *
 * @module @deepseek-ai/dsh-llm/conformance-route
 */

import type { ProbeScenario, ScenarioRunner } from './conformance-probes.ts'
import type { ToolCallId } from './brand.ts'
import type { StreamChunk } from './types.ts'

/** Which behaviours a scripted route should get WRONG; every one defaults to correct. */
export interface RouteDefects {
  /** Emit whole tool calls with no deltas, so nothing demonstrates merging. */
  readonly noToolCallDeltas?: boolean
  /** Emit only the first tool call of a parallel pair. */
  readonly dropsSecondToolCall?: boolean
  /** Omit the usage chunk. */
  readonly noUsage?: boolean
  /** End a cancelled request with `stop`, as though the model finished. */
  readonly abortReportsStop?: boolean
  /** Fail without a machine-routable code, leaving retry policy nothing to route on. */
  readonly failureWithoutCode?: boolean
  /** Truncate an over-long input and finish normally instead of refusing. */
  readonly truncatesOversizedInput?: boolean
  /** Refuse to stage this scenario at all, as an adapter that cannot be driven into it. */
  readonly cannotStage?: readonly ProbeScenario[]
}

function toolCall(index: number, id: string, args: string, withDeltas: boolean): StreamChunk[] {
  const chunks: StreamChunk[] = [{ type: 'block-start', index, blockType: 'tool-call' }]
  if (withDeltas) {
    chunks.push(
      { type: 'tool-call-delta', index, id: id as ToolCallId, name: 'read', argumentsDelta: args.slice(0, 4) },
      { type: 'tool-call-delta', index, id: id as ToolCallId, argumentsDelta: args.slice(4) },
    )
  }
  chunks.push({
    type: 'block-end',
    index,
    block: { type: 'tool-call', id: id as ToolCallId, name: 'read', arguments: args },
  })
  return chunks
}

/**
 * Build a scenario runner whose behaviour is scripted.
 * @param defects - behaviours to get wrong; omitted ones are correct.
 * @returns a runner the kit's probes can be pointed at.
 */
export function createScriptedRoute(defects: RouteDefects = {}): ScenarioRunner {
  const cannotStage = new Set(defects.cannotStage ?? [])

  async function* emit(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
    for (const chunk of chunks) yield chunk
  }

  return (scenario) => {
    if (cannotStage.has(scenario)) return null

    if (scenario === 'parallel-tool-calls') {
      const withDeltas = defects.noToolCallDeltas !== true
      const chunks = [
        ...toolCall(0, 'call_a', '{"path":"a"}', withDeltas),
        ...(defects.dropsSecondToolCall === true ? [] : toolCall(1, 'call_b', '{"path":"b"}', withDeltas)),
        ...(defects.noUsage === true ? [] : [{ type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } } as StreamChunk]),
        { type: 'finish', reason: { kind: 'tool-calls' } } as StreamChunk,
      ]
      return emit(chunks)
    }

    if (scenario === 'abort-mid-stream') {
      return emit([
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'partial' },
        defects.abortReportsStop === true
          ? { type: 'finish', reason: { kind: 'stop' } }
          : { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled by caller', code: 'ABORTED' } } },
      ])
    }

    if (scenario === 'provider-failure') {
      return emit([{
        type: 'finish',
        reason: {
          kind: 'error',
          failure: defects.failureWithoutCode === true
            ? { message: 'upstream said no', code: '' }
            : { message: 'upstream said no', code: 'PROVIDER_UNAVAILABLE', status: 503 },
        },
      }])
    }

    return emit(
      defects.truncatesOversizedInput === true
        ? [{ type: 'text-delta', index: 0, text: 'answer to a truncated question' }, { type: 'finish', reason: { kind: 'stop' } }]
        : [{ type: 'finish', reason: { kind: 'error', failure: { message: 'input too long', code: 'INPUT_TOO_LARGE', status: 413 } } }],
    )
  }
}
