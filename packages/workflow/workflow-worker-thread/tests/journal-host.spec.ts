/**
 * P4-08 Usage stage: the host's agent event stream becomes a journal.
 *
 * This file lives in the worker-thread package rather than the journal
 * package because the subject is the HOST/worker wiring -- a decision forced
 * by the pre-flight freeze-target list (BLOCKED-095), which asks where each
 * stage's freeze hangs before any code is written. The list turned up not
 * just which file but which PACKAGE, which is a question that otherwise
 * surfaces halfway through writing.
 *
 * The events used here are the shapes `WorkerRun` actually receives at
 * host.ts's AgentStart/AgentEnd cases, including `cancelled`, which the
 * journal has no outcome of its own for.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  createJournalRecorder,
  decideResume,
  journalingObserver,
  journalOutcomeOf,
  planResume,
} from '@deepseek-ai/dsh-workflow-journal'
import type { AgentStartEvent, ScriptDigest, StepEffectClass } from '@deepseek-ai/dsh-workflow-journal'

const DIGEST = brandString<ScriptDigest>('sha256-script-v1')

function pure(): StepEffectClass {
  return 'pure'
}

function event(seq: number, phase = 'Find'): AgentStartEvent {
  return { seq, label: `review:${seq}`, phase, childId: `session-${seq}` }
}

describe('P4-08 must[4]: the host stream journals a run without knowing what a journal is', () => {
  it('records a started agent call as in-flight, carrying the child session id as its receipt', () => {
    const recorder = createJournalRecorder(DIGEST)
    const observer = journalingObserver(recorder, pure)
    observer.onAgentStart(event(1))

    const entry = recorder.journal().entries[0]
    expect(entry).toMatchObject({ outcome: 'in-flight', phase: 'Find' })
    expect(entry?.childReceipts).toEqual(['session-1'])
  })

  it('settles a completed call with an output the resume can reuse', () => {
    const recorder = createJournalRecorder(DIGEST)
    const observer = journalingObserver(recorder, pure)
    observer.onAgentStart(event(1))
    observer.onAgentEnd({ ...event(1), outcome: 'completed' })
    recorder.stepVerified(1)

    expect(decideResume(recorder.journal().entries[0]!)).toMatchObject({ action: 'skip' })
  })

  it('maps `cancelled` to a failed journal outcome, so a resume re-runs it', () => {
    // A cancelled step produced no result, so a resume must re-run it -- which
    // is what `failed` already means to decideResume. A third journal outcome
    // would create a state every consumer must handle and none would treat
    // differently.
    expect(journalOutcomeOf('cancelled')).toBe('failed')

    const recorder = createJournalRecorder(DIGEST)
    const observer = journalingObserver(recorder, pure)
    observer.onAgentStart(event(1))
    observer.onAgentEnd({ ...event(1), outcome: 'cancelled' })

    expect(decideResume(recorder.journal().entries[0]!))
      .toEqual({ action: 'rerun', reason: 'not-completed' })
  })

  it('maps `failed` the same way, and `completed` differently', () => {
    // The positive control on the mapping: without it, a function returning
    // 'failed' unconditionally would satisfy the case above.
    expect(journalOutcomeOf('failed')).toBe('failed')
    expect(journalOutcomeOf('completed')).toBe('completed')
  })

  it('takes the effect class from the caller, never from the event', () => {
    // An adapter that guessed -- by label, by phase, by whether a result came
    // back -- would be inferring whether an effect escaped from outside the
    // process that produced it, which is the one thing this epic establishes
    // cannot be done.
    const recorder = createJournalRecorder(DIGEST)
    const observer = journalingObserver(recorder, () => 'side-effecting')
    observer.onAgentStart(event(1))
    observer.onAgentEnd({ ...event(1), outcome: 'completed' })
    recorder.stepVerified(1)

    // Completed, verified, produced an output -- still reconciled.
    expect(decideResume(recorder.journal().entries[0]!)).toMatchObject({ action: 'reconcile' })
  })

  it('records a call with no phase without inventing one', () => {
    const recorder = createJournalRecorder(DIGEST)
    const observer = journalingObserver(recorder, pure)
    observer.onAgentStart({ seq: 1, label: 'unphased', childId: 'session-1' })

    expect(recorder.journal().entries[0]?.phase).toBe('unphased')
  })
})

describe('P4-08 acceptance[0]: a run killed around an agent call resumes correctly', () => {
  it('kill between two agent calls: the finished one is skipped, the next re-run', () => {
    const recorder = createJournalRecorder(DIGEST)
    const observer = journalingObserver(recorder, pure)

    observer.onAgentStart(event(1))
    observer.onAgentEnd({ ...event(1), outcome: 'completed' })
    recorder.stepVerified(1)
    observer.onAgentStart(event(2))
    // process dies with agent 2 in flight

    const plan = planResume(recorder.journal(), DIGEST)
    expect(plan).toMatchObject({ resumable: true, resumeAt: 1 })
    if (!plan.resumable) throw new Error('unreachable')
    expect(plan.steps.map(step => step.action.action)).toEqual(['skip', 'rerun'])
  })

  it('kill during concurrent calls started out of order: the journal still reads in script order', () => {
    // parallel() begins several agent() calls concurrently, so starts can
    // arrive in any order; the program counter is `seq`, not arrival.
    const recorder = createJournalRecorder(DIGEST)
    const observer = journalingObserver(recorder, pure)

    observer.onAgentStart(event(2))
    observer.onAgentStart(event(1))
    observer.onAgentEnd({ ...event(1), outcome: 'completed' })
    recorder.stepVerified(1)

    const plan = planResume(recorder.journal(), DIGEST)
    if (!plan.resumable) throw new Error('unreachable')
    expect(plan.steps.map(step => step.stepId)).toEqual(['step-1', 'step-2'])
    expect(plan.resumeAt).toBe(1)
  })
})
