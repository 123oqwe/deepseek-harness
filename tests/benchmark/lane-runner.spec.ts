/**
 * Epic P0-08's Usage stage: the contract of the lane runner and its report
 * (`benchmarks/harness-capability/runner.ts`, `report.ts`).
 *
 * This file exists because the Usage stage had no test surface of its own.
 * The Contract and Fault stages both freeze `tests/benchmark/runner.spec.ts`,
 * which asserts the manifest schema and the acceptance-clause behaviour; what
 * neither covers is the runner's own contract — the promises its exported
 * functions make to a caller, independent of any one acceptance clause.
 *
 * Frozen before it was first executed, so these expectations are predictions
 * rather than transcriptions.
 *
 * Category prefixes carry the same meaning as elsewhere in this program:
 * `contract:` asserts a promise the exported surface makes; `control:` proves
 * the assertion above it measures a decision rather than a constant.
 */

import { describe, expect, it } from 'vitest'
import {
  INVARIANT_METRICS,
  STANDARD_METRICS,
  invariantsHeld,
  scoreLane,
  wilsonInterval,
} from '../../benchmarks/harness-capability/report.ts'
import { readManifest, runLanes, seededRandom, trialSeed } from '../../benchmarks/harness-capability/runner.ts'
import type { Scenario } from '../../benchmarks/harness-capability/runner.ts'

/**
 * A scenario whose outcome is fixed, so a case can state exactly what the
 * runner is given.
 * @param lane - the lane it belongs to.
 * @param name - the scenario name.
 * @param outcome - the fixed result every trial returns.
 * @returns the scenario.
 */
function fixedScenario(
  lane: string,
  name: string,
  outcome: { taskSucceeded: boolean; invariantBreaches: readonly (typeof STANDARD_METRICS)[number][] },
): Scenario {
  return { name, lane, requiresRealModel: false, run: () => outcome }
}

describe('P0-08 Usage: the runner keeps the manifest and the execution in agreement', () => {
  it('contract: readManifest returns the frozen five lanes, so the runner and the schema cannot drift apart silently', () => {
    const manifest = readManifest()
    expect(manifest.lanes.map(lane => lane.name)).toEqual(['deterministic', 'fault', 'security', 'real-model', 'scale'])
  })

  it('contract: every lane in the manifest declares exactly the eight standard metric names the report module exports', () => {
    // Two independent sources of the same list — the YAML and the TypeScript
    // constant — and nothing else keeps them equal. If they diverge, a metric
    // could be declared and never scored, or scored and never declared.
    for (const lane of readManifest().lanes) {
      expect([...lane.metrics].sort()).toEqual([...STANDARD_METRICS].sort())
    }
  })

  it('contract: the invariant metrics are a proper subset of the standard metrics, never a separate vocabulary', () => {
    for (const metric of INVARIANT_METRICS) expect(STANDARD_METRICS).toContain(metric)
    expect(INVARIANT_METRICS.length).toBeLessThan(STANDARD_METRICS.length)
  })
})

describe('P0-08 Usage: trial seeding is a function of its inputs alone', () => {
  it('contract: the same run seed, scenario and index always yield the same trial seed', () => {
    expect(trialSeed(11, 'code-world', 3)).toBe(trialSeed(11, 'code-world', 3))
  })

  it('contract: changing any one of the three inputs changes the trial seed, so a seed identifies one trial and not a family', () => {
    const base = trialSeed(11, 'code-world', 3)
    expect(trialSeed(12, 'code-world', 3)).not.toBe(base)
    expect(trialSeed(11, 'crash-world', 3)).not.toBe(base)
    expect(trialSeed(11, 'code-world', 4)).not.toBe(base)
  })

  it('contract: a generator draws the same sequence for one seed, and a different sequence for another', () => {
    const a = seededRandom(5)
    const b = seededRandom(5)
    const drawsA = [a(), a(), a()]
    const drawsB = [b(), b(), b()]
    expect(drawsB).toEqual(drawsA)
    const c = seededRandom(6)
    expect([c(), c(), c()]).not.toEqual(drawsA)
  })

  it('contract: every draw stays inside [0, 1), so a scenario indexing by it can never step outside its own range', () => {
    const next = seededRandom(20260904)
    for (let draw = 0; draw < 500; draw += 1) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('P0-08 Usage: scoreLane reports both halves of a lane without mixing them', () => {
  it('contract: every failing trial contributes a replay seed, and every breach contributes one naming its metric', () => {
    const report = scoreLane('fault', [
      { lane: 'fault', scenario: 'a', seed: 101, taskSucceeded: false, invariantBreaches: [] },
      { lane: 'fault', scenario: 'b', seed: 202, taskSucceeded: true, invariantBreaches: ['duplicate_side_effect'] },
    ])
    expect(report.replaySeeds).toContainEqual({ scenario: 'a', seed: 101, reason: 'task-failed' })
    expect(report.replaySeeds).toContainEqual({ scenario: 'b', seed: 202, reason: 'invariant:duplicate_side_effect' })
  })

  it('control: a lane where everything passed records no replay seeds, so the case above measures failures rather than emitting seeds unconditionally', () => {
    const report = scoreLane('deterministic', [
      { lane: 'deterministic', scenario: 'a', seed: 1, taskSucceeded: true, invariantBreaches: [] },
    ])
    expect(report.replaySeeds).toEqual([])
    expect(report.invariants.held).toBe(true)
  })

  it('contract: an empty lane reports a zero rate and full-width uncertainty, never a confident zero', () => {
    const report = scoreLane('scale', [])
    expect(report.model.successRate).toBe(0)
    expect(report.model.confidenceInterval).toEqual({ lower: 0, upper: 1 })
  })

  it('contract: one trial can breach more than one invariant, and each is recorded separately with its own seed', () => {
    const report = scoreLane('fault', [
      { lane: 'fault', scenario: 'a', seed: 7, taskSucceeded: false, invariantBreaches: ['duplicate_side_effect', 'policy_bypass'] },
    ])
    expect(report.invariants.breaches).toHaveLength(2)
    expect(report.invariants.breaches.map(breach => breach.metric).sort()).toEqual(['duplicate_side_effect', 'policy_bypass'])
  })
})

describe('P0-08 Usage: invariantsHeld aggregates across lanes without letting one lane speak for another', () => {
  it('contract: one breached lane fails the whole run even when every other lane is clean', () => {
    const clean = scoreLane('deterministic', [
      { lane: 'deterministic', scenario: 'a', seed: 1, taskSucceeded: true, invariantBreaches: [] },
    ])
    const breached = scoreLane('security', [
      { lane: 'security', scenario: 'b', seed: 2, taskSucceeded: true, invariantBreaches: ['policy_bypass'] },
    ])
    expect(invariantsHeld([clean, breached])).toBe(false)
  })

  it('control: the same clean lane on its own holds, so the case above fails for the breach and not for the aggregation', () => {
    const clean = scoreLane('deterministic', [
      { lane: 'deterministic', scenario: 'a', seed: 1, taskSucceeded: true, invariantBreaches: [] },
    ])
    expect(invariantsHeld([clean])).toBe(true)
  })

  it('contract: an empty report list holds, so a run that executed no lane is not reported as breached', () => {
    // The complement of the skipped-lane rule: absence must not read as
    // failure either, or an unconfigured environment would look compromised.
    expect(invariantsHeld([])).toBe(true)
  })
})

describe('P0-08 Usage: runLanes groups scenarios and reports each lane once', () => {
  it('contract: scenarios sharing a lane are scored together into a single report for that lane', () => {
    const run = runLanes(
      [
        fixedScenario('deterministic', 'a', { taskSucceeded: true, invariantBreaches: [] }),
        fixedScenario('deterministic', 'b', { taskSucceeded: false, invariantBreaches: [] }),
      ],
      { seed: 1, trialsPerScenario: 2 },
    )
    expect(run.reports).toHaveLength(1)
    expect(run.reports[0]?.model.trials).toBe(4)
    expect(run.reports[0]?.model.successes).toBe(2)
  })

  it('contract: trialsPerScenario controls the trial count exactly, so a caller can bound a run', () => {
    const run = runLanes([fixedScenario('fault', 'a', { taskSucceeded: true, invariantBreaches: [] })], {
      seed: 1,
      trialsPerScenario: 3,
    })
    expect(run.reports[0]?.model.trials).toBe(3)
  })

  it('contract: a lane is skipped only when a scenario in it requires a real model, not because a sibling lane does', () => {
    // The skip is per lane. A real-model lane going unconfigured must not
    // suppress the keyless lanes beside it.
    const run = runLanes(
      [
        fixedScenario('deterministic', 'a', { taskSucceeded: true, invariantBreaches: [] }),
        { name: 'live', lane: 'real-model', requiresRealModel: true, run: () => ({ taskSucceeded: true, invariantBreaches: [] }) },
      ],
      { seed: 1, realModelConfigured: false },
    )
    expect(run.reports.map(report => report.lane)).toEqual(['deterministic'])
    expect(run.skipped.map(entry => entry.lane)).toEqual(['real-model'])
  })
})
