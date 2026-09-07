/**
 * P4-08 Provider stage: a live execution becomes a journal.
 *
 * The recorder is driven through the same sequence a real worker session
 * produces -- start, settle, verify -- including the sequences a crash
 * creates, since a journal that only described tidy runs would be useless for
 * the one job it has.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { createJournalRecorder } from '../src/recorder.ts'
import { decideResume, planResume } from '../src/index.ts'
import type { ScriptDigest, StepId } from '../src/types.ts'

const DIGEST = brandString<ScriptDigest>('sha256-script-v1')

function start(seq: number, phase = 'Find') {
  return { seq, label: `agent-${seq}`, phase, childId: `child-${seq}` }
}

describe('P4-08 must[4]: a running execution is journalable', () => {
  it('writes an in-flight entry when a step STARTS, before it settles', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')

    // The reason a journal survives a crash. Recording only on completion
    // would leave no trace of an interrupted step, and a resume would believe
    // it never began -- indistinguishable from a step whose side effect
    // escaped just before the kill.
    const entry = recorder.journal().entries[0]
    expect(entry).toMatchObject({ outcome: 'in-flight', verified: false, output: null })
    expect(entry?.childReceipts).toEqual(['child-1'])
  })

  it('replaces the in-flight entry in place when the step settles', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')
    recorder.stepEnded({ ...start(1), outcome: 'completed', output: 'artifact-1' })

    // One entry per seq: two would make the program counter ambiguous and a
    // later compaction could not tell which was authoritative.
    const journal = recorder.journal()
    expect(journal.entries).toHaveLength(1)
    expect(journal.entries[0]).toMatchObject({ outcome: 'completed', output: 'artifact-1' })
  })

  it('orders entries by sequence even when they settle out of order', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')
    recorder.stepStarted(start(2), 'pure')
    recorder.stepEnded({ ...start(2), outcome: 'completed', output: 'a2' })
    recorder.stepEnded({ ...start(1), outcome: 'completed', output: 'a1' })

    // Parallel steps settle in any order; the program counter is the script's
    // order, not the completion order.
    expect(recorder.journal().entries.map(e => e.stepId))
      .toEqual([brandString<StepId>('step-1'), brandString<StepId>('step-2')])
  })

  it('carries the declared phase, and names an unphased step rather than omitting it', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1, 'Verify'), 'pure')
    recorder.stepStarted({ seq: 2, label: 'agent-2', childId: 'child-2' }, 'pure')

    // 'unphased' rather than an absent field: a step that declared no phase is
    // a fact, and an absent value could not be told from one nobody recorded.
    expect(recorder.journal().entries.map(e => e.phase)).toEqual(['Verify', 'unphased'])
  })

  it('orders by sequence even when steps START out of order', () => {
    // parallel() begins several agent() calls concurrently, so the recorder
    // cannot assume starts arrive in sequence order. Insertion order is not
    // the program counter; `seq` is.
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(3), 'pure')
    recorder.stepStarted(start(1), 'pure')
    recorder.stepStarted(start(2), 'pure')

    expect(recorder.journal().entries.map(e => e.stepId)).toEqual(['step-1', 'step-2', 'step-3'])
  })
})

describe('P4-08: the recorder does not invent what the execution did not report', () => {
  it('drops a settlement for a step that never started', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepEnded({ ...start(1), outcome: 'completed', output: 'a1' })

    // An entry conjured here would carry an effect class nobody declared, and
    // decideResume would then act on a guess.
    expect(recorder.journal().entries).toEqual([])
  })

  it('refuses to mark an in-flight step verified', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')
    recorder.stepVerified(1)

    // Verifying an unfinished step would let a resume skip work that never
    // produced a result.
    expect(recorder.journal().entries[0]?.verified).toBe(false)
  })

  it('refuses to mark a FAILED step verified', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')
    recorder.stepEnded({ ...start(1), outcome: 'failed' })
    recorder.stepVerified(1)

    expect(recorder.journal().entries[0]?.verified).toBe(false)
  })

  it('marks a completed step verified when asked', () => {
    // The positive control: without it, a recorder that verified nothing would
    // satisfy both refusals above.
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')
    recorder.stepEnded({ ...start(1), outcome: 'completed', output: 'a1' })
    recorder.stepVerified(1)

    expect(recorder.journal().entries[0]?.verified).toBe(true)
  })

  it('records the effect class the caller declared, never one it inferred', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'side-effecting')
    recorder.stepEnded({ ...start(1), outcome: 'completed', output: 'a1' })
    recorder.stepVerified(1)

    // Completed, verified, produced an output -- and still reconciled, because
    // the script said it touches the world.
    expect(decideResume(recorder.journal().entries[0]!)).toMatchObject({ action: 'reconcile' })
  })
})

describe('P4-08 acceptance[0]: a journal recorded up to a kill drives the right resume', () => {
  it('kill BEFORE the agent call settles: the step is re-run', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')
    recorder.stepEnded({ ...start(1), outcome: 'completed', output: 'a1' })
    recorder.stepVerified(1)
    recorder.stepStarted(start(2), 'pure')
    // process dies here

    const plan = planResume(recorder.journal(), DIGEST)
    expect(plan).toMatchObject({ resumable: true, resumeAt: 1 })
  })

  it('kill AFTER the agent call settles but before verification: still re-run', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')
    recorder.stepEnded({ ...start(1), outcome: 'completed', output: 'a1' })
    // died before stepVerified

    const plan = planResume(recorder.journal(), DIGEST)
    expect(plan).toMatchObject({ resumeAt: 0 })
    if (!plan.resumable) throw new Error('unreachable')
    expect(plan.steps[0]?.action).toEqual({ action: 'rerun', reason: 'completed-but-unverified' })
  })

  it('kill after verification: the completed child work is NOT repeated', () => {
    const recorder = createJournalRecorder(DIGEST)
    recorder.stepStarted(start(1), 'pure')
    recorder.stepEnded({ ...start(1), outcome: 'completed', output: 'a1' })
    recorder.stepVerified(1)

    const plan = planResume(recorder.journal(), DIGEST)
    expect(plan).toMatchObject({ resumeAt: 1 })
    if (!plan.resumable) throw new Error('unreachable')
    expect(plan.steps[0]?.action).toMatchObject({ action: 'skip' })
  })
})
