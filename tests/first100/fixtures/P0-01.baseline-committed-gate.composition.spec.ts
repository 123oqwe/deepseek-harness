/**
 * P0-01 1-1 (must[2]) — the exact-SHA workflow does not gate the COMMITTED
 * baseline. must[2]: before any execution batch, verify the committed baseline
 * fingerprint and, on upstream drift, stop and emit a rebase report. On the
 * factory path (`.github/workflows/first100-exact-sha.yml`) the only baseline
 * verification in the gate job runs `baseline:capture && baseline:verify` in one
 * checkout — `capture` OVERWRITES `.dsh/baseline.json` before `verify` reads it,
 * so verify always passes against what it just wrote and committed-baseline drift
 * is never caught (the step's own comment admits this; drift is deferred to
 * `baseline-preflight`, which is `disabled: true` in the shipped bundle).
 *
 * This witnesses must[2] STRUCTURALLY on the workflow a CI run actually executes.
 *
 * RED at the candidate: no job in the workflow verifies the committed baseline —
 * every `baseline:verify` is preceded, in its own `run` or earlier in its job, by
 * a `baseline:capture` that overwrites the committed file first.
 * GREEN once a committed-baseline gate is wired: a `baseline:verify` that reads the
 * committed `.dsh/baseline.json` with no same-job `baseline:capture` ahead of it.
 * @module tests/first100/fixtures/P0-01.baseline-committed-gate.composition
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  readonly name?: string
  readonly run?: string
}
interface Job {
  readonly steps?: readonly Step[]
}
interface Workflow {
  readonly jobs: Record<string, Job>
}

const workflowPath = fileURLToPath(new URL('../../../.github/workflows/first100-exact-sha.yml', import.meta.url))
const workflow = load(readFileSync(workflowPath, 'utf8')) as Workflow

const runOf = (step: Step): string => step.run ?? ''
const capturesBaseline = (step: Step): boolean => /\bbaseline:capture\b/.test(runOf(step))
const verifiesBaseline = (step: Step): boolean => /\bbaseline:verify\b/.test(runOf(step))

/**
 * Does this job verify the COMMITTED baseline? True when some step runs
 * `baseline:verify`, does NOT run `baseline:capture` in its own `run`, and no
 * earlier step in the same job ran `baseline:capture` — so the `.dsh/baseline.json`
 * reaching `verify` is the committed file, not one this job just captured.
 */
function verifiesCommittedBaseline(job: Job): boolean {
  const steps = job.steps ?? []
  return steps.some((step, index) =>
    verifiesBaseline(step)
    && !capturesBaseline(step)
    && !steps.slice(0, index).some(capturesBaseline))
}

describe('P0-01 1-1: the exact-SHA workflow gates the committed baseline (must[2])', () => {
  it('a job verifies the committed .dsh/baseline.json with no same-job capture ahead of it', () => {
    const verified = Object.values(workflow.jobs).some(verifiesCommittedBaseline)
    expect(verified).toBe(true)
  })

  it('control: a same-run `baseline:capture && baseline:verify` step exists (the capture-first flaw being gated)', () => {
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
    expect(steps.some(step => capturesBaseline(step) && verifiesBaseline(step))).toBe(true)
  })
})
