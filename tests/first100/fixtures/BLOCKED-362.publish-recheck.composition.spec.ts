/**
 * BLOCKED-362 (defense in depth on the publish pipelines): each publish job must
 * re-check, across the job boundary, that the tarballs it downloaded match the
 * evidence the pack job sealed — the file set, each tarball's sha256, and
 * `accepted === true` — BEFORE it publishes, and fail hard on any mismatch. Today
 * the three publish jobs download the tarball artifact and run `Publish tarballs`
 * directly with no cross-job re-check, so a tarball swapped between pack and publish
 * would ship. A release workflow cannot be triggered from a test (publishing costs
 * money and is forbidden here), so its STRUCTURE is read: the re-check step's
 * presence, its position before the publish step, that nothing lets it fail softly,
 * and that the pack job ships the evidence under its own artifact so the publish job
 * has it to re-check against.
 *
 * §17: this is the structure red-first (lane A); the (b) fix — the verify script's
 * cross-job behavior and its unit tests — is lane B's white box and is NOT read here.
 * The harness follows the frozen P0-07 publish-workflow structure spec.
 * @module tests/first100/fixtures/BLOCKED-362.publish-recheck.composition
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** One workflow step, as far as this case reads it. */
interface WorkflowStep {
  readonly name?: string
  readonly run?: string
  readonly uses?: string
  readonly if?: string
  readonly 'continue-on-error'?: unknown
  readonly with?: { readonly name?: string; readonly path?: string }
}

/** A publish workflow, as far as this case reads it. */
interface PublishWorkflow {
  readonly jobs: {
    readonly pack: { readonly steps: readonly WorkflowStep[] }
    readonly publish: { readonly steps: readonly WorkflowStep[]; readonly 'continue-on-error'?: unknown }
  }
}

/** The publish step every pipeline names identically; the re-check must precede it. */
const PUBLISH_STEP = 'Publish tarballs'

/**
 * The evidence re-check in the publish job, matched by INTENT, not by the fix's script name:
 * a step that hands the sealed evidence package to a verifier — the `--evidence <path>` flag,
 * or the bundle's own path `.dsh/evidence`. Keying on a specific verifier name would miss a
 * fix that adds a new script and so could not tell a real fix from a mutation; the intent
 * (consuming the evidence package) is read from the clause, never from the fix's body.
 */
const RECHECK_STEP = /--evidence\b|\.dsh\/evidence/

/** The sealed evidence bundle's path, so the pack job's own-artifact upload is found by what it ships. */
const EVIDENCE_PATH = /\.dsh\/evidence/

/**
 * What would let a failed re-check pass its step, so publishing continues over a
 * mismatch. The re-check command itself is lane B's white box and is not pinned here.
 * @param step - the re-check step, or undefined when there is none.
 * @param job - the publish job, whose own `continue-on-error` would soften every step.
 * @returns one entry per softening; empty when a failed re-check fails the job.
 */
function softenings(step: WorkflowStep | undefined, job: PublishWorkflow['jobs']['publish']): string[] {
  const problems: string[] = []
  if (step?.if !== undefined) problems.push('step if')
  if (step?.['continue-on-error'] !== undefined) problems.push('step continue-on-error')
  if (job['continue-on-error'] !== undefined) problems.push('job continue-on-error')
  return problems
}

const WORKFLOWS = ['release-publish.yml', 'release-vendor-publish.yml', 'node-addon-system-release.yml']

describe('BLOCKED-362: each publish job re-checks the downloaded tarballs against the evidence before publishing', () => {
  it.each(WORKFLOWS)('%s re-checks the evidence in a hard-failing step before Publish, and the pack job ships the evidence as its own artifact', (file) => {
    const workflow = load(readFileSync(join(repoRoot, '.github/workflows', file), 'utf8')) as PublishWorkflow
    const steps = workflow.jobs.publish.steps

    const publishAt = steps.findIndex(step => step.name === PUBLISH_STEP)
    expect(publishAt, `${file}: no "${PUBLISH_STEP}" step in the publish job`).toBeGreaterThanOrEqual(0)

    // RED on 390f761fb5 (pre-fix): the publish job downloads the tarballs and publishes them
    // with no cross-job re-check. GREEN once lane B's fix adds the re-check before Publish.
    const recheckAt = steps.findIndex(step => RECHECK_STEP.test(step.run ?? ''))
    expect(recheckAt, `${file}: the publish job has no cross-job evidence re-check before it publishes`).toBeGreaterThanOrEqual(0)
    expect(recheckAt, `${file}: the re-check must run before "${PUBLISH_STEP}"`).toBeLessThan(publishAt)
    expect(softenings(steps[recheckAt], workflow.jobs.publish), `${file}: what would let a failed re-check publish anyway`).toEqual([])

    // The publish job can only re-check what the pack job ships it: the evidence under its
    // own artifact, not folded into the tarballs.
    const evidenceUpload = workflow.jobs.pack.steps.find(step =>
      (step.uses ?? '').startsWith('actions/upload-artifact') && EVIDENCE_PATH.test(step.with?.path ?? ''))
    expect(evidenceUpload, `${file}: the pack job does not upload the evidence as its own artifact`).toBeDefined()
  })
})
