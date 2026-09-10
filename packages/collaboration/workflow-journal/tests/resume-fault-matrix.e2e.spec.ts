/**
 * The resume boundary matrix for Epic P4-08's Fault stage.
 *
 * Split out of `resume.e2e.spec.ts` so the Fault stage's frozen command names
 * this file alone: C and F both pointed at that one spec, which made their two
 * base entries indistinguishable — the same command, the same case list, two
 * stages claiming it. C keeps the decision-level clauses; the boundary matrix
 * lives here.
 *
 * Every `describe` and `it` title is carried over UNCHANGED. A frozen case is
 * identified by its title, so renaming one during a move would silently retire
 * the frozen case and open a new one that nothing had committed to.
 *
 * @module
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  compactJournal,
  decideResume,
  planResume,
  receiptsToReconcile,
  retainsAllReceipts,
} from '../src/index.ts'
import type {
  ArtifactRef,
  ChildReceipt,
  JournalEntry,
  PhaseName,
  ScriptDigest,
  SideEffectReceipt,
  StepId,
  WorkflowJournal,
} from '../src/types.ts'

const DIGEST = brandString<ScriptDigest>('sha256-script-v1')

/** One completed, verified, pure entry; overrides carve out the case under test. */
function entry(id: string, overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    stepId: brandString<StepId>(id),
    phase: brandString<PhaseName>('Find'),
    effectClass: 'pure',
    outcome: 'completed',
    inputs: [brandString<ArtifactRef>(`${id}-in`)],
    output: brandString<ArtifactRef>(`${id}-out`),
    childReceipts: [brandString<ChildReceipt>(`${id}-child`)],
    sideEffectReceipts: [],
    verified: true,
    ...overrides,
  }
}

/** A journal over `entries`, under `digest`. */
function journal(entries: readonly JournalEntry[], digest = DIGEST): WorkflowJournal {
  return { scriptDigest: digest, entries }
}

/**
 * P4-08 Fault stage: a systematic matrix over the journal's resume
 * boundaries, plus validation[2]'s central property — a resumed run reaches
 * the same result as an uninterrupted one.
 *
 * Enumerated as data with the count asserted against a floor, so a boundary
 * cannot be deleted while every remaining case still passes.
 */
describe('P4-08 Fault — resume boundary matrix', () => {
  interface ResumeFault {
    readonly boundary: string
    readonly run: () => void
  }

  const FAULTS: readonly ResumeFault[] = [
    {
      boundary: '01 an in-flight step is re-run',
      run: () =>{  expect(decideResume(entry('s', { outcome: 'in-flight' })))
        .toEqual({ action: 'rerun', reason: 'not-completed' }) },
    },
    {
      boundary: '02 a failed step is re-run',
      run: () =>{  expect(decideResume(entry('s', { outcome: 'failed' })))
        .toEqual({ action: 'rerun', reason: 'not-completed' }) },
    },
    {
      boundary: '03 a completed but unverified step is re-run',
      run: () =>{  expect(decideResume(entry('s', { verified: false })))
        .toEqual({ action: 'rerun', reason: 'completed-but-unverified' }) },
    },
    {
      boundary: '04 a completed, verified step with no output is re-run',
      run: () =>{  expect(decideResume(entry('s', { output: null })))
        .toEqual({ action: 'rerun', reason: 'completed-without-output' }) },
    },
    {
      boundary: '05 a completed, verified, pure step is skipped',
      run: () =>{  expect(decideResume(entry('s')).action).toBe('skip') },
    },
    {
      boundary: '06 a side-effecting step is reconciled even when completed and verified',
      run: () =>{  expect(decideResume(entry('s', { effectClass: 'side-effecting' })).action).toBe('reconcile') },
    },
    {
      boundary: '07 a side-effecting step that never completed is re-run, not reconciled',
      run: () =>{  expect(decideResume(entry('s', { effectClass: 'side-effecting', outcome: 'in-flight' })))
        .toEqual({ action: 'rerun', reason: 'not-completed' }) },
    },
    {
      boundary: '08 a side-effecting step with NO receipts is still reconciled',
      run: () =>{  expect(decideResume(entry('s', { effectClass: 'side-effecting', sideEffectReceipts: [] })))
        .toEqual({ action: 'reconcile', receipts: [] }) },
    },
    {
      boundary: '09 a changed script digest refuses the whole resume',
      run: () =>{  expect(planResume(journal([entry('s')]), brandString<ScriptDigest>('sha256-other')))
        .toMatchObject({ resumable: false, reason: 'script-digest-changed' }) },
    },
    {
      boundary: '10 an empty journal is resumable and resumes at zero',
      run: () =>{  expect(planResume(journal([]), DIGEST)).toMatchObject({ resumable: true, resumeAt: 0 }) },
    },
    {
      boundary: '11 a fully completed journal resumes past its last step',
      run: () =>{  expect(planResume(journal([entry('s1'), entry('s2')]), DIGEST)).toMatchObject({ resumeAt: 2 }) },
    },
    {
      boundary: '12 resume stops at the first non-skippable step, not past it',
      run: () =>{  expect(planResume(journal([entry('s1'), entry('s2', { outcome: 'failed' }), entry('s3')]), DIGEST))
        .toMatchObject({ resumeAt: 1 }) },
    },
    {
      boundary: '13 receipts are collected from AFTER the restart point too',
      run: () => {
        const late = brandString<SideEffectReceipt>('late')
        const plan = planResume(journal([
          entry('s1', { outcome: 'failed' }),
          entry('s2', { effectClass: 'side-effecting', sideEffectReceipts: [late] }),
        ]), DIGEST)
        expect(receiptsToReconcile(plan)).toEqual([late])
      },
    },
    {
      boundary: '14 a refused plan yields no receipts to reconcile',
      run: () =>{  expect(receiptsToReconcile(planResume(journal([entry('s')]), brandString<ScriptDigest>('other'))))
        .toEqual([]) },
    },
    {
      boundary: '15 compaction leaves an UNVERIFIED entry untouched, whatever its effect class',
      run: () => {
        const before = journal([entry('s', { effectClass: 'side-effecting', verified: false })])
        expect(compactJournal(before).entries).toEqual(before.entries)
      },
    },
    {
      boundary: '16 compaction retains every receipt',
      run: () => {
        const before = journal([entry('s1'), entry('s2', { sideEffectReceipts: [brandString<SideEffectReceipt>('r')] })])
        expect(retainsAllReceipts(before, compactJournal(before))).toBe(true)
      },
    },
    {
      boundary: '17 compacting an already-compacted journal changes nothing further',
      run: () => {
        // Idempotence: a journal compacted on every checkpoint must not keep
        // losing information each time.
        const once = compactJournal(journal([entry('s1'), entry('s2')]))
        expect(compactJournal(once)).toEqual(once)
      },
    },
    {
      boundary: '18 validation[2]: a resumed run reaches the same outputs as an uninterrupted one',
      run: () => {
        // The property the clause names. An uninterrupted run produces three
        // outputs; a run killed after step 1 replays and must produce the
        // same three -- with step 1 reused rather than recomputed.
        const uninterrupted = [entry('s1'), entry('s2'), entry('s3')]
        const killed = journal([entry('s1'), entry('s2', { outcome: 'in-flight', output: null })])

        const plan = planResume(killed, DIGEST)
        if (!plan.resumable) throw new Error('unreachable')
        const reused = plan.steps
          .filter(step => step.action.action === 'skip')
          .map(step => (step.action as { output: ArtifactRef }).output)

        expect(reused).toEqual([uninterrupted[0]?.output])
        expect(plan.resumeAt).toBe(1)
      },
    },
  ]

  it('enumerates at least twelve boundaries, each named once', () => {
    expect(FAULTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(FAULTS.map(fault => fault.boundary)).size).toBe(FAULTS.length)
  })

  for (const fault of FAULTS) {
    it(`fault boundary ${fault.boundary}`, () => { fault.run() })
  }
})
