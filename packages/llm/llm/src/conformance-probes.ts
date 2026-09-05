/**
 * Probes that turn an adapter's chunk stream into conformance outcomes
 * (Epic P9-01, Provider stage).
 *
 * `./conformance.ts` decides what a route must demonstrate. This decides what a
 * given stream actually did demonstrate.
 *
 * **It covers only the behaviours a chunk stream can show.** Three of the six
 * — `error-retry-classification`, `oversized-input-rejection`, and a real
 * `mid-stream-abort` against a live connection — need the adapter's REQUEST
 * path and a server that can misbehave, which is the mock-server half of this
 * epic and is not built yet. Those behaviours are therefore ABSENT from the
 * outcomes rather than reported as passing, so `admitConformantRoute` denies
 * the route. That is the intended behaviour of an incomplete kit: a suite that
 * reported the untested three as green would be exactly the vacuous pass the
 * gate exists to reject.
 *
 * @module @deepseek-ai/dsh-llm/conformance-probes
 */

import type { ConformanceOutcome } from './conformance.ts'
import type { StreamChunk } from './types.ts'

/** What a stream showed about tool calls, usage and termination. */
interface StreamObservation {
  /** Concatenated `argumentsDelta` per block index, in arrival order. */
  readonly deltasByIndex: Map<number, string>
  /** Final `arguments` per block index, from each `block-end`. */
  readonly finalByIndex: Map<number, string>
  /** How many distinct tool-call blocks ended. */
  readonly toolCallBlocks: number
  /** Whether a `usage` chunk arrived. */
  readonly sawUsage: boolean
  /** Whether a `finish` chunk arrived. */
  readonly sawFinish: boolean
}

/**
 * Read a stream into the facts the probes need.
 * @param chunks - the adapter's chunk stream.
 * @returns what the stream showed.
 */
export async function observeStream(chunks: AsyncIterable<StreamChunk>): Promise<StreamObservation> {
  const deltasByIndex = new Map<number, string>()
  const finalByIndex = new Map<number, string>()
  let toolCallBlocks = 0
  let sawUsage = false
  let sawFinish = false
  for await (const chunk of chunks) {
    if (chunk.type === 'tool-call-delta') {
      deltasByIndex.set(chunk.index, (deltasByIndex.get(chunk.index) ?? '') + chunk.argumentsDelta)
    } else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      finalByIndex.set(chunk.index, chunk.block.arguments)
      toolCallBlocks += 1
    } else if (chunk.type === 'usage') {
      sawUsage = true
    } else if (chunk.type === 'finish') {
      sawFinish = true
    }
  }
  return { deltasByIndex, finalByIndex, toolCallBlocks, sawUsage, sawFinish }
}

/**
 * Whether every tool call's deltas concatenate to its final arguments.
 *
 * This is the property a caller depends on and cannot check afterwards: once
 * the stream is consumed, a merged call that dropped a delta looks exactly like
 * one that never received it. A block that ended without any delta counts as a
 * failure rather than a pass, since an adapter that emits whole calls and never
 * streams them has not demonstrated merging.
 * @param observation - what the stream showed.
 * @returns whether merging held for every tool call.
 */
export function deltasMergeIntoFinalCalls(observation: StreamObservation): boolean {
  if (observation.finalByIndex.size === 0) return false
  for (const [index, final] of observation.finalByIndex) {
    if (observation.deltasByIndex.get(index) !== final) return false
  }
  return true
}

/**
 * Run every probe a chunk stream supports.
 *
 * Each outcome carries its case count, because `admitConformantRoute` denies a
 * pass reported over zero cases: a probe that ran nothing has shown nothing,
 * whatever verdict it returns.
 * @param chunks - the adapter's chunk stream for a request that calls two tools.
 * @returns one outcome per stream-observable behaviour; the other three are absent.
 */
export async function runStreamProbes(chunks: AsyncIterable<StreamChunk>): Promise<ConformanceOutcome[]> {
  const observation = await observeStream(chunks)
  return [
    {
      behavior: 'streaming-tool-call-deltas',
      passed: deltasMergeIntoFinalCalls(observation),
      cases: observation.finalByIndex.size,
    },
    {
      // Two is the smallest number that distinguishes "surfaces every call"
      // from "surfaces the first and drops the rest", which is the failure this
      // behaviour exists to catch.
      behavior: 'parallel-tool-calls',
      passed: observation.toolCallBlocks >= 2,
      cases: observation.toolCallBlocks,
    },
    {
      // A stream that ended without `usage` leaves the caller unable to account
      // for what the request cost, so absence is a failure and not a silence.
      behavior: 'usage-accounting',
      passed: observation.sawUsage && observation.sawFinish,
      cases: observation.sawFinish ? 1 : 0,
    },
  ]
}
