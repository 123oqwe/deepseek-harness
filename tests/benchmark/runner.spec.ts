/**
 * Contract-stage RED scaffold for Epic P0-08 (upgrade BENCHMARK.md into a general-purpose
 * Harness capability benchmark framework). Stage C's declared files hold no `.ts` source
 * under benchmarks/harness-capability/ -- runner.ts, report.ts, and scenarios/ are U-stage.
 * The must[]/acceptance[] text describes runtime properties (lanes execute, seeded
 * reproducibility, real-model scoring separated from baseline invariants) that cannot be
 * tested without that U-stage runner existing.
 *
 * This suite instead freezes and tests the one thing Contract-stage CAN commit to now: the
 * structural schema benchmarks/harness-capability/manifest.yml must satisfy (must[0]-[2]).
 * acceptance[0]-[2] all require the U-stage runner and are NOT covered here.
 *
 * manifest.yml is authored deliberately incomplete relative to the frozen schema below (real
 * file, real js-yaml parse, no throwing stub) so every case genuinely fails on a structural
 * mismatch -- the direct analog of a throwing `not implemented` stub in the .ts-package
 * C-stage pattern used by every other epic this session.
 *
 * Each `it()` below runs a positive control first (a hardcoded fixture that satisfies the
 * frozen schema, proving the comparator recognizes a complete lane as complete) and then
 * checks the real manifest.yml against the same frozen schema (which fails). Both checks live
 * in one test case, not two, so that every case in this file's vitest report shows
 * status "failed" -- a standalone all-positive case would report "passed", which would put a
 * green case in a Contract-stage RED scaffold.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'js-yaml'

import { resolveRepoRoot } from '../../scripts/first100/common.ts'

/** must[0]: the exact 5 lanes benchmarks/harness-capability/manifest.yml must declare. */
const REQUIRED_LANES = ['deterministic', 'fault', 'security', 'real-model', 'scale'] as const

/** must[1]: the exact 8 standard metrics every required lane must declare. */
const REQUIRED_METRICS = [
  'task_success',
  'duplicate_side_effect',
  'policy_bypass',
  'recovery_success',
  'verification_precision',
  'router_regret',
  'token_cost',
  'latency',
] as const

interface LaneReporting {
  confidenceInterval?: boolean
  seedReplay?: boolean
}

interface Lane {
  name: string
  metrics?: string[]
  reporting?: LaneReporting
}

interface Manifest {
  schemaVersion?: number
  lanes?: Lane[]
}

function loadManifest(): Manifest {
  const repoRoot = resolveRepoRoot()
  const raw = readFileSync(join(repoRoot, 'benchmarks/harness-capability/manifest.yml'), 'utf8')
  // Parse boundary: js-yaml's `load` returns `unknown`; this cast is the schema this suite tests.
  return yaml.load(raw) as Manifest
}

/** must[1]: lane metric-set mismatches against REQUIRED_METRICS, empty when exactly matched. */
function laneMetricMismatches(lane: Lane | undefined, required: readonly string[]): string[] {
  if (!lane) return ['lane not present in manifest.yml']
  const actual = new Set(lane.metrics ?? [])
  const requiredSet = new Set(required)
  const missing = required.filter(metric => !actual.has(metric))
  const extra = [...actual].filter(metric => !requiredSet.has(metric))
  return [
    ...missing.map(metric => `missing metric "${metric}"`),
    ...extra.map(metric => `unexpected metric "${metric}"`),
  ]
}

/** must[2]: lane reporting-flag mismatches, empty when both confidenceInterval and seedReplay are true. */
function laneReportingMismatches(lane: Lane | undefined): string[] {
  if (!lane) return ['lane not present in manifest.yml']
  const issues: string[] = []
  if (lane.reporting?.confidenceInterval !== true) issues.push('reporting.confidenceInterval is not true')
  if (lane.reporting?.seedReplay !== true) issues.push('reporting.seedReplay is not true')
  return issues
}

describe('benchmarks/harness-capability/manifest.yml structural contract (P0-08 Contract-stage)', () => {
  it('must[0]: declares exactly the 5 required lanes (deterministic, fault, security, real-model, scale), no extras', () => {
    // Positive control: the exact-set comparator recognizes the 5 required names as complete
    // even given in a different order than REQUIRED_LANES itself.
    const reorderedComplete = ['scale', 'security', 'deterministic', 'real-model', 'fault']
    expect([...reorderedComplete].sort()).toEqual([...REQUIRED_LANES].sort())

    // Real manifest.yml: missing real-model and scale, plus an unrequired "smoke-lane" extra.
    const manifest = loadManifest()
    const actualLaneNames = (manifest.lanes ?? []).map(lane => lane.name)
    expect([...actualLaneNames].sort()).toEqual([...REQUIRED_LANES].sort())
  })

  it('must[1]: each required lane declares exactly the 8 standard metrics', () => {
    // Positive control: a lane with exactly the 8 required metrics, listed out of frozen
    // order, is recognized as complete -- zero missing, zero unexpected.
    const completeLaneFixture: Lane = {
      name: 'deterministic',
      metrics: [
        'latency',
        'token_cost',
        'router_regret',
        'verification_precision',
        'recovery_success',
        'policy_bypass',
        'duplicate_side_effect',
        'task_success',
      ],
    }
    expect(laneMetricMismatches(completeLaneFixture, REQUIRED_METRICS)).toEqual([])

    // Real manifest.yml: deterministic is missing 4 metrics, fault swaps in the wrong name
    // "latency_p95" instead of "latency", and real-model/scale are absent entirely.
    const manifest = loadManifest()
    const mismatches = REQUIRED_LANES.flatMap(laneName => {
      const lane = manifest.lanes?.find(candidate => candidate.name === laneName)
      return laneMetricMismatches(lane, REQUIRED_METRICS).map(issue => `${laneName}: ${issue}`)
    })
    expect(mismatches).toEqual([])
  })

  it('must[2]: each required lane\'s report declares confidenceInterval and a replayable seed', () => {
    // Positive control: a lane whose reporting block sets both flags true is recognized as
    // satisfying the confidence-interval/seed-replay requirement.
    const completeLaneFixture: Lane = {
      name: 'deterministic',
      reporting: { confidenceInterval: true, seedReplay: true },
    }
    expect(laneReportingMismatches(completeLaneFixture)).toEqual([])

    // Real manifest.yml: deterministic satisfies this alone, but fault is missing seedReplay,
    // security has no reporting block, and real-model/scale are absent entirely.
    const manifest = loadManifest()
    const mismatches = REQUIRED_LANES.flatMap(laneName => {
      const lane = manifest.lanes?.find(candidate => candidate.name === laneName)
      return laneReportingMismatches(lane).map(issue => `${laneName}: ${issue}`)
    })
    expect(mismatches).toEqual([])
  })
})
