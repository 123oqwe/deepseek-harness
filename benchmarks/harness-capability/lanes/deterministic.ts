/**
 * The deterministic lane of the Harness capability benchmark (Epic P0-08).
 *
 * Each trial replays one recorded headless session through the shipped
 * product and is judged against the recording: the task succeeded when the
 * last turn ends for the same reason with the same final assistant text and
 * every tool result matches the recording once both are normalized (T1).
 * Nothing in a replay can reach past the policy or fail on purpose, so the
 * lane declares policy_bypass and recovery_success not applicable; the
 * shipped product has no verifier and no router, so verification_precision
 * and router_regret are not applicable either (BLOCKED-335).
 * @module benchmarks/harness-capability/lanes/deterministic
 */

import { join } from 'node:path'
import type { Manifest, ManifestLane } from '../manifest.ts'
import {
  canonicalJson,
  duplicateSideEffectsOf,
  normalizedLogs,
  readRecordedScenario,
  records,
  REPO_ROOT,
  replayRecordedScenario,
  sha256,
  tokenCostOf,
  tokenCostSource,
} from '../product.ts'
import {
  countMetric,
  laneMetrics,
  meanMetric,
  proportionMetric,
  type LaneReport,
  type ToolResultMismatch,
  type Trial,
} from '../report.ts'
import { drawScenarios, trialSeed } from '../seed.ts'

/**
 * Compare a trial's tool results with the recording's, in order.
 * @param expected - the recording's normalized primary log.
 * @param actual - the trial's normalized primary log, or `undefined` when the run persisted none.
 * @returns how many of the recording's tool results were compared, and every position where the two differ.
 */
function compareToolResults(expected: string, actual: string | undefined): { compared: number; mismatches: ToolResultMismatch[] } {
  const results = (log: string | undefined): string[] => log === undefined ? [] : records(log).filter(record => record.type === 'tool/result').map(canonicalJson)
  const want = results(expected)
  const got = results(actual)
  const mismatches: ToolResultMismatch[] = []
  for (let index = 0; index < Math.max(want.length, got.length); index++) {
    if (want[index] !== got[index]) mismatches.push({ index, expected: want[index] ?? null, actual: got[index] ?? null })
  }
  return { compared: want.length, mismatches }
}

/**
 * The reason the last turn of a normalized log ended, and its final assistant text.
 * @param log - a normalized primary log, or `undefined`.
 * @returns both, as canonical text.
 */
function outcomeOf(log: string | undefined): string {
  if (log === undefined) return 'no session log'
  const all = records(log)
  const reason = (all.filter(record => record.type === 'turn/end').at(-1)?.data as { reason?: unknown } | undefined)?.reason ?? null
  const message = (all.filter(record => record.type === 'assistant/message').at(-1)?.data as { message?: { content?: unknown } } | undefined)?.message
  const text = Array.isArray(message?.content)
    ? (message.content as { type?: unknown; text?: unknown }[]).flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('')
    : ''
  return canonicalJson({ reason, text })
}

/**
 * Run the deterministic lane.
 * @param lane - the lane as the manifest declares it: its trial count, scenarios and not-applicable metrics.
 * @param seed - the run seed.
 * @param manifest - the whole manifest, for the recordings, the replay composition, the trial timeout and the prices.
 * @returns the lane's report; its `knownRed` is empty.
 * @throws when the manifest gives the lane no trials, no scenarios, no known-red check date, or no reason for a metric it does not compute.
 */
export function runDeterministicLane(lane: ManifestLane, seed: number, manifest: Manifest): LaneReport {
  const scenarios = lane.scenarios ?? []
  const knownRedCheckedOn = lane.knownRedCheckedOn
  if (lane.trials === undefined || lane.trials < 1 || scenarios.length === 0 || knownRedCheckedOn === undefined) {
    throw new Error('benchmark manifest.yml: the deterministic lane needs a positive trials count, at least one scenario and the date its known-red list was checked')
  }
  const recordings = join(REPO_ROOT, manifest.recordings)
  const composition = join(REPO_ROOT, manifest.composition)
  const trials: Trial[] = drawScenarios(scenarios, lane.trials, seed).map((name, index): Trial => {
    const scenario = readRecordedScenario(recordings, name)
    const run = replayRecordedScenario(scenario, { composition, timeoutMs: manifest.trialTimeoutMs })
    const [expected] = normalizedLogs([scenario.recording])
    if (expected === undefined) throw new Error(`benchmark scenario ${name}: its recording normalized to nothing`)
    const actual = normalizedLogs(run.logs)
    const toolResults = compareToolResults(expected, actual[0])
    if (toolResults.compared === 0) throw new Error(`benchmark scenario ${name}: its recording has no tool result to compare (T1)`)
    return {
      scenario: name,
      seed: trialSeed(seed, name, index),
      launch: { argv: run.argv },
      exitCode: run.exitCode,
      sessionLogs: run.logs.map((raw, log) => ({ digest: sha256(actual[log] ?? ''), rawSha256: sha256(raw) })),
      failure: null,
      toolResults,
      taskSucceeded: toolResults.mismatches.length === 0 && outcomeOf(actual[0]) === outcomeOf(expected),
      duplicateSideEffects: duplicateSideEffectsOf(run.logs),
      tokenCost: tokenCostOf(run.logs, manifest.pricing),
      latencyMs: run.latencyMs,
    }
  })
  const n = trials.length
  const from = (what: string): string => `${what}, over ${String(n)} trials that each replayed a recorded headless session through the shipped product`
  const metrics = laneMetrics('deterministic', {
    task_success: proportionMetric(trials.filter(trial => trial.taskSucceeded).length, n,
      from('last turn-end reason, final assistant text and tool results compared with the recording')),
    duplicate_side_effect: countMetric(trials.filter(trial => trial.duplicateSideEffects > 0).length, n,
      from('trials whose session logs append one idempotency key\'s action manifest more than once')),
    token_cost: meanMetric(trials.map(trial => trial.tokenCost), seed, from(tokenCostSource(manifest.pricing))),
    latency: meanMetric(trials.map(trial => trial.latencyMs), seed, from('milliseconds of wall-clock time per product run')),
  }, lane.notApplicable)
  return { lane: 'deterministic', trials, metrics, knownRed: [], knownRedCheckedOn }
}
