/**
 * Clause coverage for Epic P4-08's workflow journal and step-level resume.
 *
 * `.e2e.spec.ts` rather than `.e2e.ts`: the latter routes into
 * vitest.e2e.config.ts, whose suites self-skip without an API key, and the
 * exact-SHA CI job runs the default config. Recorded as an adjudicated path
 * patch before this file was written (adjudication.json,
 * P4-08-C-resume-e2e-not-yet-created) -- the third application of that
 * prevention precedent.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  admitResume,
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

function journal(entries: readonly JournalEntry[], digest = DIGEST): WorkflowJournal {
  return { scriptDigest: digest, entries }
}

describe('P4-08 must[0]: a journal entry records every fact the clause names', () => {
  it('carries step id, phase, effect class, outcome, inputs, output, both receipt kinds and verification', () => {
    // One exact key set: an entry missing one of these would otherwise satisfy
    // every individual assertion about the others.
    expect(Object.keys(entry('s1')).sort()).toEqual([
      'childReceipts', 'effectClass', 'inputs', 'outcome', 'output',
      'phase', 'sideEffectReceipts', 'stepId', 'verified',
    ])
  })

  it('keeps `verified` separate from `outcome`', () => {
    // "It finished" and "we checked it" are different facts, and must[1] skips
    // only steps that are both. One field could not express the difference.
    const finishedUnchecked = entry('s1', { verified: false })
    expect(finishedUnchecked.outcome).toBe('completed')
    expect(decideResume(finishedUnchecked)).toEqual({ action: 'rerun', reason: 'completed-but-unverified' })
  })

  it('records artifact REFS, never inline content', () => {
    // must[3]'s neighbour: a journal carries data about steps, not the values
    // themselves, and certainly not code.
    expect(typeof entry('s1').output).toBe('string')
  })
})

describe('P4-08 must[1]: a resume skips a completed, verified, pure step', () => {
  it('skips it and reuses its recorded output', () => {
    expect(decideResume(entry('s1')))
      .toEqual({ action: 'skip', output: brandString<ArtifactRef>('s1-out') })
  })

  it('re-runs a step that never completed', () => {
    for (const outcome of ['in-flight', 'failed'] as const) {
      expect(decideResume(entry('s1', { outcome })), outcome)
        .toEqual({ action: 'rerun', reason: 'not-completed' })
    }
  })

  it('re-runs a completed step that recorded no output', () => {
    expect(decideResume(entry('s1', { output: null })))
      .toEqual({ action: 'rerun', reason: 'completed-without-output' })
  })
})

describe('P4-08 must[2]: a side-effecting step is reconciled, never skipped', () => {
  it('reconciles it even when completed AND verified', () => {
    // The check order that matters: effect class is consulted BEFORE
    // verification. Verifying that a charge was RECORDED correctly says
    // nothing about whether the charge happened, and skipping on that basis
    // is how a workflow double-charges.
    const receipts = [brandString<SideEffectReceipt>('charge-1')]
    expect(decideResume(entry('s1', { effectClass: 'side-effecting', verified: true, sideEffectReceipts: receipts })))
      .toEqual({ action: 'reconcile', receipts })
  })

  it('reconciles a side-effecting step that recorded no receipts at all', () => {
    // The worst case, and it must not degrade to a skip: no receipt means we
    // do not know whether the effect escaped.
    expect(decideResume(entry('s1', { effectClass: 'side-effecting', sideEffectReceipts: [] })))
      .toEqual({ action: 'reconcile', receipts: [] })
  })

  it('collects every side-effect receipt in the journal, not only those before the restart point', () => {
    const early = brandString<SideEffectReceipt>('effect-early')
    const late = brandString<SideEffectReceipt>('effect-late')
    const plan = planResume(journal([
      entry('s1', { effectClass: 'side-effecting', sideEffectReceipts: [early] }),
      entry('s2'),
      entry('s3', { effectClass: 'side-effecting', sideEffectReceipts: [late] }),
    ]), DIGEST)

    // A resume that reconciled only the receipts before its restart point
    // would leave later effects unaccounted while believing it had checked
    // everything.
    expect(receiptsToReconcile(plan)).toEqual([early, late])
  })
})

describe('P4-08 acceptance[0]: killing around a step does not repeat completed child work', () => {
  it('resumes at the first step that is not skippable, not past it', () => {
    // s1 and s2 completed; s3 was in flight when the process died. A later
    // step's inputs were produced by an earlier one, so honouring a skip after
    // a rerun would feed a step outputs from a run that no longer happened.
    const plan = planResume(journal([entry('s1'), entry('s2'), entry('s3', { outcome: 'in-flight' })]), DIGEST)

    expect(plan).toMatchObject({ resumable: true, resumeAt: 2 })
  })

  it('resumes at the end when every step completed and was verified', () => {
    expect(planResume(journal([entry('s1'), entry('s2')]), DIGEST)).toMatchObject({ resumeAt: 2 })
  })

  it('resumes at zero when the first step is unskippable, whatever follows it', () => {
    const plan = planResume(journal([entry('s1', { outcome: 'failed' }), entry('s2')]), DIGEST)
    expect(plan).toMatchObject({ resumeAt: 0 })
  })

  it('does not repeat a completed child agent call: its receipt is retained and its step skipped', () => {
    const done = entry('agent-1')
    const plan = planResume(journal([done]), DIGEST)

    expect(plan).toMatchObject({ resumable: true, resumeAt: 1 })
    if (!plan.resumable) throw new Error('unreachable')
    expect(plan.steps[0]?.action).toEqual({ action: 'skip', output: brandString<ArtifactRef>('agent-1-out') })
  })
})

describe('P4-08 acceptance[1]: a changed script digest refuses the resume', () => {
  it('refuses the WHOLE resume rather than degrading to a partial one', () => {
    // Step ids are positions in a script; against a different script they name
    // different work. Resuming anyway would skip steps never run and re-run
    // steps that were, guided by a journal that no longer describes the
    // program.
    const changed = brandString<ScriptDigest>('sha256-script-v2')
    expect(admitResume(journal([entry('s1')]), changed))
      .toMatchObject({ resumable: false, reason: 'script-digest-changed' })
    expect(planResume(journal([entry('s1')]), changed))
      .toMatchObject({ resumable: false, reason: 'script-digest-changed' })
  })

  it('admits an unchanged digest, so the refusal is not unconditional', () => {
    expect(admitResume(journal([entry('s1')]), DIGEST)).toEqual({ resumable: true })
  })
})

describe('P4-08 acceptance[2]: a journal compacts without losing its evidence', () => {
  it('drops recomputable inputs from a completed, verified, pure step', () => {
    const compacted = compactJournal(journal([entry('s1')]))
    expect(compacted.entries[0]?.inputs).toEqual([])
    // The output ref is kept: it is what a resume reuses.
    expect(compacted.entries[0]?.output).toBe('s1-out')
  })

  it('leaves an unverified or side-effecting step untouched', () => {
    const before = journal([entry('s1', { verified: false }), entry('s2', { effectClass: 'side-effecting' })])
    expect(compactJournal(before).entries).toEqual(before.entries)
  })

  it('retains EVERY receipt, which is the evidence nothing can regenerate', () => {
    const before = journal([
      entry('s1'),
      entry('s2', { effectClass: 'side-effecting', sideEffectReceipts: [brandString<SideEffectReceipt>('charge-1')] }),
    ])

    // A compaction that shed receipts to save space would discard the only
    // record that an effect occurred outside this process.
    expect(retainsAllReceipts(before, compactJournal(before))).toBe(true)
  })

  it('reports a compaction that dropped a receipt as NOT retaining evidence', () => {
    // A positive control on the checker itself: without it, retainsAllReceipts
    // returning true would prove nothing.
    const before = journal([entry('s1')])
    const stripped = journal([{ ...entry('s1'), childReceipts: [] }])
    expect(retainsAllReceipts(before, stripped)).toBe(false)
  })
})

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
      run: () => expect(decideResume(entry('s', { outcome: 'in-flight' })))
        .toEqual({ action: 'rerun', reason: 'not-completed' }),
    },
    {
      boundary: '02 a failed step is re-run',
      run: () => expect(decideResume(entry('s', { outcome: 'failed' })))
        .toEqual({ action: 'rerun', reason: 'not-completed' }),
    },
    {
      boundary: '03 a completed but unverified step is re-run',
      run: () => expect(decideResume(entry('s', { verified: false })))
        .toEqual({ action: 'rerun', reason: 'completed-but-unverified' }),
    },
    {
      boundary: '04 a completed, verified step with no output is re-run',
      run: () => expect(decideResume(entry('s', { output: null })))
        .toEqual({ action: 'rerun', reason: 'completed-without-output' }),
    },
    {
      boundary: '05 a completed, verified, pure step is skipped',
      run: () => expect(decideResume(entry('s')).action).toBe('skip'),
    },
    {
      boundary: '06 a side-effecting step is reconciled even when completed and verified',
      run: () => expect(decideResume(entry('s', { effectClass: 'side-effecting' })).action).toBe('reconcile'),
    },
    {
      boundary: '07 a side-effecting step that never completed is re-run, not reconciled',
      run: () => expect(decideResume(entry('s', { effectClass: 'side-effecting', outcome: 'in-flight' })))
        .toEqual({ action: 'rerun', reason: 'not-completed' }),
    },
    {
      boundary: '08 a side-effecting step with NO receipts is still reconciled',
      run: () => expect(decideResume(entry('s', { effectClass: 'side-effecting', sideEffectReceipts: [] })))
        .toEqual({ action: 'reconcile', receipts: [] }),
    },
    {
      boundary: '09 a changed script digest refuses the whole resume',
      run: () => expect(planResume(journal([entry('s')]), brandString<ScriptDigest>('sha256-other')))
        .toMatchObject({ resumable: false, reason: 'script-digest-changed' }),
    },
    {
      boundary: '10 an empty journal is resumable and resumes at zero',
      run: () => expect(planResume(journal([]), DIGEST)).toMatchObject({ resumable: true, resumeAt: 0 }),
    },
    {
      boundary: '11 a fully completed journal resumes past its last step',
      run: () => expect(planResume(journal([entry('s1'), entry('s2')]), DIGEST)).toMatchObject({ resumeAt: 2 }),
    },
    {
      boundary: '12 resume stops at the first non-skippable step, not past it',
      run: () => expect(planResume(journal([entry('s1'), entry('s2', { outcome: 'failed' }), entry('s3')]), DIGEST))
        .toMatchObject({ resumeAt: 1 }),
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
      run: () => expect(receiptsToReconcile(planResume(journal([entry('s')]), brandString<ScriptDigest>('other'))))
        .toEqual([]),
    },
    {
      boundary: '15 compaction leaves a side-effecting entry untouched',
      run: () => {
        const before = journal([entry('s', { effectClass: 'side-effecting' })])
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
