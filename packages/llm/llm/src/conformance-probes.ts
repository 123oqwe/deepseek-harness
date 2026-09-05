/**
 * Probes that turn an adapter's chunk stream into conformance outcomes
 * (Epic P9-01, Provider stage).
 *
 * `./conformance.ts` decides what a route must demonstrate. This decides what a
 * given stream actually did demonstrate.
 *
 * All six behaviours are covered. Three are read from a single stream; the
 * other three need the adapter driven through a SCENARIO — a cancelled request,
 * a failing one, an over-long one — because what they assert is how the adapter
 * ends a stream it cannot finish normally. `runAllProbes` takes a scenario
 * runner rather than a stream, which is what lets a caller point the kit at a
 * real adapter or at `createScriptedRoute` below.
 *
 * A behaviour whose scenario the runner cannot produce stays ABSENT from the
 * outcomes rather than being reported as passing. `admitConformantRoute` then
 * denies the route, which is the intended behaviour of a partial kit: reporting
 * an untested behaviour as green is the vacuous pass the gate exists to
 * reject.
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

/** The request shapes a route must be driven through to show every behaviour. */
export type ProbeScenario =
  /** A normal request that calls two tools. */
  | 'parallel-tool-calls'
  /** A request cancelled after the stream has begun. */
  | 'abort-mid-stream'
  /** A request the provider rejects with a transport or status failure. */
  | 'provider-failure'
  /** A request whose input exceeds what the route accepts. */
  | 'oversized-input'

/** Produces the adapter's stream for one scenario, or null when it cannot stage it. */
export type ScenarioRunner = (scenario: ProbeScenario) => AsyncIterable<StreamChunk> | null

/** The finish chunk a stream ended with, when it emitted one. */
async function finishOf(chunks: AsyncIterable<StreamChunk>): Promise<Extract<StreamChunk, { type: 'finish' }> | null> {
  let finish: Extract<StreamChunk, { type: 'finish' }> | null = null
  for await (const chunk of chunks) {
    if (chunk.type === 'finish') finish = chunk
  }
  return finish
}

/**
 * Run every probe, including the three that need a staged scenario.
 *
 * A scenario the runner declines leaves its behaviour out of the result, so an
 * adapter that cannot be driven into a failure is not credited with handling
 * one.
 * @param run - stages one scenario and returns the adapter's stream.
 * @returns one outcome per behaviour the runner could stage.
 */
export async function runAllProbes(run: ScenarioRunner): Promise<ConformanceOutcome[]> {
  const outcomes: ConformanceOutcome[] = []

  const normal = run('parallel-tool-calls')
  if (normal !== null) outcomes.push(...await runStreamProbes(normal))

  const aborted = run('abort-mid-stream')
  if (aborted !== null) {
    const finish = await finishOf(aborted)
    // A cancelled request must END, and say it was cancelled. A stream that
    // simply stops emitting leaves the caller unable to tell cancellation from
    // a hang, and one that reports `stop` claims the model finished normally.
    outcomes.push({
      behavior: 'mid-stream-abort',
      passed: finish?.reason.kind === 'aborted',
      cases: finish === null ? 0 : 1,
    })
  }

  const failed = run('provider-failure')
  if (failed !== null) {
    const finish = await finishOf(failed)
    const failure = finish?.reason.kind === 'error' ? finish.reason.failure : undefined
    // `llm-retry` routes on `code`, so a failure without one is unroutable and
    // the policy layer can only guess. An empty string is treated as absent
    // rather than as a code, because it carries no more information than none.
    outcomes.push({
      behavior: 'error-retry-classification',
      passed: failure !== undefined && failure.code.length > 0,
      cases: finish === null ? 0 : 1,
    })
  }

  const oversized = run('oversized-input')
  if (oversized !== null) {
    const finish = await finishOf(oversized)
    // Refusing is the required behaviour; the failure mode this catches is an
    // adapter that TRUNCATES and finishes normally, which silently answers a
    // different question than the caller asked.
    outcomes.push({
      behavior: 'oversized-input-rejection',
      passed: finish?.reason.kind === 'error',
      cases: finish === null ? 0 : 1,
    })
  }

  return outcomes
}
