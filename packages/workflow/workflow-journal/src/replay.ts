/**
 * Replaying a journal into a resume plan (Epic P4-08 must[1], must[2],
 * acceptance[2]).
 *
 * `./types.ts` decides one entry at a time. This module walks a whole journal
 * and produces the plan a resumed run follows, plus the compaction that keeps
 * a long-running workflow's journal bounded without discarding the evidence
 * its receipts constitute.
 *
 * @module @deepseek-ai/dsh-workflow-journal/replay
 */

import { admitResume, decideResume } from './types.ts'
import type {
  ArtifactRef,
  JournalEntry,
  ResumeAction,
  ScriptDigest,
  SideEffectReceipt,
  StepId,
  WorkflowJournal,
} from './types.ts'

/** One step's place in a resume plan. */
export interface PlannedStep {
  readonly stepId: StepId
  readonly action: ResumeAction
}

/** The plan a resumed run follows, or the refusal to resume at all. */
export type ResumePlan =
  | { readonly resumable: true; readonly steps: readonly PlannedStep[]; readonly resumeAt: number }
  | { readonly resumable: false; readonly reason: string; readonly detail: string }

/**
 * Build a resume plan from a journal and the script about to run.
 *
 * `resumeAt` is the index of the first step the run must actually execute —
 * the leading run of skippable steps, and no further. It stops at the first
 * step needing rerun or reconciliation rather than skipping past it to
 * whatever follows: a later step's recorded inputs were produced by the
 * earlier one, so honouring a skip after a rerun would feed a step outputs
 * from a run that no longer happened.
 * @param journal - the journal recorded by the interrupted run.
 * @param scriptDigest - the digest of the script about to run.
 * @returns the plan, or the refusal with its reason.
 */
export function planResume(journal: WorkflowJournal, scriptDigest: ScriptDigest): ResumePlan {
  const admission = admitResume(journal, scriptDigest)
  if (!admission.resumable) {
    return { resumable: false, reason: admission.reason, detail: admission.detail }
  }
  const steps = journal.entries.map(entry => ({ stepId: entry.stepId, action: decideResume(entry) }))
  const firstNonSkip = steps.findIndex(step => step.action.action !== 'skip')
  return { resumable: true, steps, resumeAt: firstNonSkip === -1 ? steps.length : firstNonSkip }
}

/**
 * Every side-effect receipt a resumed run must reconcile before proceeding
 * (must[2]).
 *
 * Collected across the whole journal rather than only up to `resumeAt`: a
 * side-effecting step anywhere in the record reached the world, and a resume
 * that reconciled only the ones before its restart point would leave later
 * effects unaccounted while believing it had checked everything.
 * @param plan - a resumable plan.
 * @returns the receipts, in journal order.
 */
export function receiptsToReconcile(plan: ResumePlan): readonly SideEffectReceipt[] {
  if (!plan.resumable) return []
  return plan.steps.flatMap(step => (step.action.action === 'reconcile' ? step.action.receipts : []))
}

/**
 * Compact a journal while retaining its original evidence (acceptance[2]).
 *
 * Compaction drops what can be recomputed and keeps what cannot. A completed,
 * verified, pure step's INPUTS are recomputable from the steps that produced
 * them, so they are dropped; its output ref is kept, because that ref is what
 * a resume reuses.
 *
 * Receipts are never dropped, from any entry. A receipt is evidence that
 * something happened outside this process, and nothing inside it can
 * regenerate that. A compaction that shed receipts to save space would be
 * discarding the only record that an effect occurred — which is why
 * acceptance[2] permits compaction and requires the raw evidence to survive it.
 * @param journal - the journal to compact.
 * @returns a compacted journal with every receipt intact.
 */
export function compactJournal(journal: WorkflowJournal): WorkflowJournal {
  const entries: JournalEntry[] = journal.entries.map((entry) => {
    const compactable = entry.outcome === 'completed' && entry.verified && entry.effectClass === 'pure'
    if (!compactable) return entry
    return { ...entry, inputs: [] as readonly ArtifactRef[] }
  })
  return { scriptDigest: journal.scriptDigest, entries }
}

/**
 * Whether compaction preserved every receipt the original journal held.
 *
 * Exported so the property acceptance[2] names is checkable by a caller and
 * not only by this package's own tests — a compaction whose evidence-retention
 * can only be verified by its author is the kind of claim this program keeps
 * finding to be false.
 * @param before - the journal before compaction.
 * @param after - the journal after compaction.
 * @returns whether every child and side-effect receipt survived.
 */
export function retainsAllReceipts(before: WorkflowJournal, after: WorkflowJournal): boolean {
  const collect = (journal: WorkflowJournal): string[] =>
    journal.entries.flatMap(entry => [...entry.childReceipts, ...entry.sideEffectReceipts]).sort()
  const originals = collect(before)
  const survivors = new Set(collect(after))
  return originals.every(receipt => survivors.has(receipt))
}
