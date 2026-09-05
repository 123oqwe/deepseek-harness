/**
 * Recording a live workflow execution into a journal (Epic P4-08 must[4]).
 *
 * `./types.ts` and `./replay.ts` decide what a journal MEANS. This module is
 * where one comes from: a recorder that observes a running execution and
 * appends an entry per step, so the DSL and worker API are journalable without
 * either of them knowing what a journal is.
 *
 * It records only what the execution reports. It never inspects the script,
 * never captures a closure, and never derives an entry's effect class from
 * what a step appeared to do — that classification is the script's to declare
 * (`./types.ts`), because whether an effect escaped cannot be known from
 * inside the process that ran it.
 *
 * @module @deepseek-ai/dsh-workflow-journal/recorder
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  ArtifactRef,
  ChildReceipt,
  JournalEntry,
  PhaseName,
  ScriptDigest,
  StepEffectClass,
  StepId,
  WorkflowJournal,
} from './types.ts'

/** One `agent()` call starting, as the execution reports it. */
export interface StepStart {
  /** 1-based sequence number within the run; the program counter. */
  readonly seq: number
  readonly label: string
  readonly phase?: string
  /** The child agent's session id, which becomes its receipt. */
  readonly childId: string
}

/** The same call settling. */
export interface StepEnd extends StepStart {
  readonly outcome: 'completed' | 'failed'
  /** Where the result was stored, when it produced one. */
  readonly output?: string
}

/** The journal a recorder is building, plus the operations that extend it. */
export interface JournalRecorder {
  /** Record a step beginning; the entry is `in-flight` until it settles. */
  readonly stepStarted: (start: StepStart, effectClass: StepEffectClass) => void
  /** Record a step settling; replaces the in-flight entry in place. */
  readonly stepEnded: (end: StepEnd) => void
  /** Mark a completed step's result as checked (must[1]'s second half). */
  readonly stepVerified: (seq: number) => void
  /** The journal as it stands, safe to persist at any moment. */
  readonly journal: () => WorkflowJournal
}

/**
 * Build a recorder for one run.
 *
 * An entry is written when a step STARTS, not when it finishes. That ordering
 * is the whole reason a journal survives a crash: a process killed mid-step
 * leaves an `in-flight` entry, which `decideResume` re-runs. Recording only on
 * completion would leave no trace of the step at all, and a resume would
 * believe it had never begun — which is indistinguishable from a step whose
 * side effect escaped just before the kill.
 *
 * A step that settles replaces its own entry rather than appending a second.
 * Two entries for one `seq` would make the program counter ambiguous, and a
 * later compaction could not tell which one was authoritative.
 * @param scriptDigest - the digest of the script being run.
 * @returns a recorder over a fresh journal.
 */
export function createJournalRecorder(scriptDigest: ScriptDigest): JournalRecorder {
  const entries = new Map<number, JournalEntry>()

  const phaseOf = (phase: string | undefined): PhaseName =>
    brandString<PhaseName>(phase ?? 'unphased')

  return {
    stepStarted(start, effectClass) {
      entries.set(start.seq, {
        stepId: brandString<StepId>(`step-${start.seq}`),
        phase: phaseOf(start.phase),
        effectClass,
        outcome: 'in-flight',
        inputs: [],
        output: null,
        childReceipts: [brandString<ChildReceipt>(start.childId)],
        sideEffectReceipts: [],
        verified: false,
      })
    },
    stepEnded(end) {
      const existing = entries.get(end.seq)
      // A settlement for a step that was never started is dropped rather than
      // invented: an entry conjured here would carry an effect class nobody
      // declared, and `decideResume` would then act on a guess.
      if (existing === undefined) return
      entries.set(end.seq, {
        ...existing,
        outcome: end.outcome,
        output: end.output === undefined ? null : brandString<ArtifactRef>(end.output),
      })
    },
    stepVerified(seq) {
      const existing = entries.get(seq)
      // Only a COMPLETED step can be verified. Marking an in-flight or failed
      // step verified would let `decideResume` skip work that never produced
      // a result.
      if (existing === undefined || existing.outcome !== 'completed') return
      entries.set(seq, { ...existing, verified: true })
    },
    journal() {
      return {
        scriptDigest,
        entries: [...entries.keys()].sort((left, right) => left - right).map(seq => entries.get(seq) as JournalEntry),
      }
    },
  }
}
