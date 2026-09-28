/**
 * What survives in this suite after B-573 rebuilt benchmarks/harness-capability into a
 * recorded-session product benchmark (P0-08, BLOCKED-325/335): the pseudo-random scenario
 * worlds and the `runLanes`/`seededRandom`/`trialSeed` exports are gone, and the per-lane
 * `metrics`/`reporting` manifest schema is replaced by `trials`/`scenarios`/`notApplicable`
 * and a pricing block. Two things this file still owns hold here:
 *
 * - must[0]: benchmarks/harness-capability/manifest.yml declares exactly the five required
 *   lanes (deterministic, fault, security, real-model, scale), read from the real file
 *   through js-yaml — the one structural fact the manifest still commits to.
 * - The report module's `wilsonInterval` stays honest at the sample sizes these lanes run
 *   (no zero-width interval on a unanimous sample, full uncertainty at zero trials).
 *
 * must[1] (the eight standard metrics) and must[2] (a report declaring a confidence interval
 * and a replayable seed) are no longer manifest-structural facts: they are properties of the
 * report the recorded-session product benchmark writes, and are tested by
 * tests/first100/fixtures/P0-08.benchmark-product.spec.ts (R2, R4).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'js-yaml'

import { resolveRepoRoot } from '../../scripts/first100/common.ts'
import { wilsonInterval } from '../../benchmarks/harness-capability/report.ts'

/** must[0]: the exact 5 lanes benchmarks/harness-capability/manifest.yml must declare. */
const REQUIRED_LANES = ['deterministic', 'fault', 'security', 'real-model', 'scale'] as const

interface Lane {
  name: string
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

describe('benchmarks/harness-capability/manifest.yml structural contract (P0-08 Contract-stage)', () => {
  it('must[0]: declares exactly the 5 required lanes (deterministic, fault, security, real-model, scale), no extras', () => {
    // Positive control: the exact-set comparator recognizes the 5 required names as complete
    // even given in a different order than REQUIRED_LANES itself.
    const reorderedComplete = ['scale', 'security', 'deterministic', 'real-model', 'fault']
    expect([...reorderedComplete].sort()).toEqual([...REQUIRED_LANES].sort())

    // Real manifest.yml: after B-573 rebuilt the harness (schemaVersion 2) it declares exactly
    // the five required lanes.
    const manifest = loadManifest()
    const actualLaneNames = (manifest.lanes ?? []).map(lane => lane.name)
    expect([...actualLaneNames].sort()).toEqual([...REQUIRED_LANES].sort())
  })
})

describe('P0-08 Fault: must[2] — confidence intervals stay honest at the sample sizes these lanes run', () => {
  it('enforcement: a unanimous sample does not report a zero-width interval', () => {
    // The normal approximation collapses to [1, 1] at 8/8 — certainty from the
    // sample least able to support it. Wilson keeps a real lower bound.
    const interval = wilsonInterval(8, 8)
    expect(interval.upper).toBe(1)
    expect(interval.lower).toBeLessThan(1)
    expect(interval.lower).toBeGreaterThan(0)
  })

  it('enforcement: zero trials report full uncertainty rather than a confident zero', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 1 })
  })

  it('control: a larger unanimous sample narrows the interval, so the bound tracks evidence', () => {
    expect(wilsonInterval(200, 200).lower).toBeGreaterThan(wilsonInterval(8, 8).lower)
  })
})
