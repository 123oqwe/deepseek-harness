/**
 * Lane runner for the Harness capability benchmark (Epic P0-08).
 *
 * Executes the lanes `manifest.yml` declares. Which lanes can run is decided
 * here rather than by the caller, because acceptance[0] is a property of the
 * framework and not of how someone invoked it: the `deterministic`, `fault`
 * and `security` lanes must run to completion with no external API configured,
 * and `real-model` must be the only lane that cannot.
 *
 * Determinism is the other half (acceptance[1]): a lane runs from a seed, and
 * the same seed must reproduce the same event projection and the same failure
 * position. Scenarios therefore draw every choice from the injected generator
 * and never from `Math.random` or the clock.
 *
 * @module benchmarks/harness-capability/runner
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { scoreLane, type LaneReport, type StandardMetric, type TrialOutcome } from './report.ts'

/** Lanes that must run with no external API configured (acceptance[0]). */
export const KEYLESS_LANES = ['deterministic', 'fault', 'security'] as const

/** The lane that requires a real model, and is the only one that may be skipped. */
export const REAL_MODEL_LANE = 'real-model'

/** A lane as declared in `manifest.yml`. */
export interface ManifestLane {
  readonly name: string
  readonly metrics: readonly string[]
  readonly reporting: { readonly confidenceInterval: boolean; readonly seedReplay: boolean }
}

/** The parsed benchmark manifest. */
export interface Manifest {
  readonly schemaVersion: number
  readonly lanes: readonly ManifestLane[]
}

/**
 * A deterministic 32-bit generator. Seeded explicitly so a failure's seed is
 * the whole of what a replay needs (must[2]); `Math.random` would make a
 * recorded seed unable to reproduce anything.
 * @param seed - the starting state.
 * @returns a function yielding the next value in `[0, 1)`.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    // xorshift32: same sequence for the same seed on every platform.
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
}

/** One scenario a lane can execute. */
export interface Scenario {
  readonly name: string
  /** The lane this scenario belongs to. */
  readonly lane: string
  /** Whether the scenario needs a configured external model. */
  readonly requiresRealModel: boolean
  /**
   * Run once with an injected generator.
   * @param next - the seeded generator; the scenario's only source of variation.
   * @returns whether the task succeeded, and any base-invariant breaches observed.
   */
  run(next: () => number): { taskSucceeded: boolean; invariantBreaches: readonly StandardMetric[] }
}

/** What one `runLanes` call produced. */
export interface BenchmarkRun {
  readonly reports: readonly LaneReport[]
  /** Lanes that did not run, with the reason — only `real-model` may appear. */
  readonly skipped: readonly { readonly lane: string; readonly reason: string }[]
}

/**
 * Read and parse the frozen manifest.
 * @param root - repository root; defaults to this file's own package directory.
 * @returns the parsed manifest.
 */
export function readManifest(root = dirname(fileURLToPath(import.meta.url))): Manifest {
  return yaml.load(readFileSync(join(root, 'manifest.yml'), 'utf8')) as Manifest
}

/**
 * Execute every lane the manifest declares.
 *
 * A lane whose scenarios need no external model runs regardless of
 * configuration; `real-model` is skipped, with a recorded reason, when no key
 * is configured. A skipped lane never contributes a passing invariant result —
 * it contributes nothing at all, so absence can never read as success.
 * @param scenarios - the scenarios available to run.
 * @param options - `seed` for the run, `trialsPerScenario`, and whether a real model is configured.
 * @returns each executed lane's report plus the lanes that were skipped.
 */
export function runLanes(
  scenarios: readonly Scenario[],
  options: { readonly seed: number; readonly trialsPerScenario?: number; readonly realModelConfigured?: boolean },
): BenchmarkRun {
  const trialsPerScenario = options.trialsPerScenario ?? 8
  const realModelConfigured = options.realModelConfigured ?? false
  const reports: LaneReport[] = []
  const skipped: { lane: string; reason: string }[] = []

  const byLane = new Map<string, Scenario[]>()
  for (const scenario of scenarios) {
    const bucket = byLane.get(scenario.lane) ?? []
    bucket.push(scenario)
    byLane.set(scenario.lane, bucket)
  }

  for (const [lane, laneScenarios] of byLane) {
    if (laneScenarios.some(scenario => scenario.requiresRealModel) && !realModelConfigured) {
      skipped.push({ lane, reason: 'no external model configured' })
      continue
    }
    const trials: TrialOutcome[] = []
    for (const scenario of laneScenarios) {
      for (let trial = 0; trial < trialsPerScenario; trial += 1) {
        // The seed is derived from the run seed, the scenario name and the
        // trial index, so one recorded seed replays exactly one trial and the
        // whole run is reproducible from `options.seed` alone.
        const seed = trialSeed(options.seed, scenario.name, trial)
        const outcome = scenario.run(seededRandom(seed))
        trials.push({
          lane,
          scenario: scenario.name,
          seed,
          taskSucceeded: outcome.taskSucceeded,
          invariantBreaches: outcome.invariantBreaches,
        })
      }
    }
    reports.push(scoreLane(lane, trials))
  }

  return { reports, skipped }
}

/**
 * Derive one trial's seed. Deterministic in all three inputs so a report's
 * recorded seed identifies exactly one trial.
 * @param runSeed - the run's base seed.
 * @param scenario - the scenario name.
 * @param trial - the trial index within that scenario.
 * @returns the trial's seed.
 */
export function trialSeed(runSeed: number, scenario: string, trial: number): number {
  let hash = runSeed >>> 0
  for (const character of `${scenario}#${trial}`) {
    hash = (Math.imul(hash ^ character.charCodeAt(0), 0x0100_0193) >>> 0) || 1
  }
  return hash
}

/**
 * Format one run for a terminal, with the two halves of acceptance[2] printed
 * as separate columns so neither can be read as the other.
 * @param run - the executed run.
 * @returns the lines to print, in order.
 */
export function formatRun(run: BenchmarkRun): string[] {
  const lines: string[] = []
  for (const report of run.reports) {
    const { lower, upper } = report.model.confidenceInterval
    lines.push(
      `${report.lane}: task success ${report.model.successes}/${report.model.trials} ` +
        `(95% CI ${lower.toFixed(3)}-${upper.toFixed(3)}) | ` +
        `invariants ${report.invariants.held ? 'held' : `BREACHED (${report.invariants.breaches.length})`}`,
    )
    for (const breach of report.invariants.breaches) {
      lines.push(`  breach ${breach.metric} in ${breach.scenario} — replay with --seed ${breach.seed}`)
    }
  }
  for (const entry of run.skipped) lines.push(`${entry.lane}: skipped — ${entry.reason}`)
  return lines
}
