/**
 * The workflow journal: what a run records so it can be resumed (Epic P4-08).
 *
 * A journal exists to answer one question after a crash — *which steps already
 * happened, and which of them may be trusted?* Those are two questions, and
 * conflating them is the failure this module is shaped around: a step that
 * completed is not automatically a step whose result may be reused. A pure
 * step's recorded output is its result. A side-effecting step's recorded
 * output is a claim about the world that may since have become false.
 *
 * **No closure is ever serialized (must[3]).** A journal entry names a step
 * and carries data; it never carries code. A resumed run re-enters the script
 * and is steered by the journal, rather than reconstructing a suspended
 * continuation — which could not be verified against the script it came from
 * and would silently resurrect logic the script no longer contains.
 *
 * @module @deepseek-ai/dsh-workflow-journal/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one workflow script by content, so a changed script is a different one. */
export type ScriptDigest = Branded<'ScriptDigest'>

/** A step's position in the script; stable across runs of the same script. */
export type StepId = Branded<'StepId'>

/** A reference to stored content, never the content itself. */
export type ArtifactRef = Branded<'ArtifactRef'>

/** A child agent's acknowledgement that it did the work. */
export type ChildReceipt = Branded<'ChildReceipt'>

/** Evidence that a side effect reached the world. */
export type SideEffectReceipt = Branded<'SideEffectReceipt'>

/** Which phase of the workflow a step belonged to. */
export type PhaseName = Branded<'PhaseName'>

/**
 * Whether a step may be skipped on resume, or must be reconciled first.
 *
 * This is a property of the STEP, declared by the script, not something the
 * journal infers from what a step did. Inferring it would mean deciding after
 * the fact whether an effect escaped, which is exactly what cannot be known
 * from inside the process that crashed.
 */
export type StepEffectClass =
  /** Depends only on its inputs; its recorded output is its result. */
  | 'pure'
  /** Reached outside the process; its recorded output is a claim about the world. */
  | 'side-effecting'

/** How a step ended. */
export type StepOutcome = 'completed' | 'failed' | 'in-flight'

/** One journal entry: everything must[0] requires recorded per step. */
export interface JournalEntry {
  readonly stepId: StepId
  readonly phase: PhaseName
  readonly effectClass: StepEffectClass
  readonly outcome: StepOutcome
  readonly inputs: readonly ArtifactRef[]
  /** Absent while in-flight; a completed step always has one. */
  readonly output: ArtifactRef | null
  readonly childReceipts: readonly ChildReceipt[]
  readonly sideEffectReceipts: readonly SideEffectReceipt[]
  /**
   * Whether this entry's recorded result was verified against its inputs
   * after the fact (must[1]).
   *
   * Separate from `outcome` because "it finished" and "we checked it" are
   * different facts, and must[1] skips only steps that are BOTH.
   */
  readonly verified: boolean
}

/** A complete journal for one run. */
export interface WorkflowJournal {
  readonly scriptDigest: ScriptDigest
  /** Entries in execution order; the program counter is this array's length. */
  readonly entries: readonly JournalEntry[]
}

/** What a resumed run should do with one recorded step. */
export type ResumeAction =
  /** Completed, verified, and pure: reuse its recorded output (must[1]). */
  | { readonly action: 'skip'; readonly output: ArtifactRef }
  /** Completed but side-effecting: its receipts must be reconciled first (must[2]). */
  | { readonly action: 'reconcile'; readonly receipts: readonly SideEffectReceipt[] }
  /** Not completed, not verified, or nothing recorded: run it again. */
  | { readonly action: 'rerun'; readonly reason: RerunReason }

/** Why a step must be re-run rather than skipped. */
export type RerunReason =
  | 'not-completed'
  | 'completed-but-unverified'
  | 'completed-without-output'

/**
 * Decide what a resumed run does with one journal entry.
 *
 * The order of the checks is the contract. Completion is checked first,
 * because an in-flight or failed step tells us nothing else worth acting on.
 * Effect class is checked BEFORE verification, because a side-effecting step
 * is reconciled whether or not its output was verified — verifying that a
 * charge was recorded correctly says nothing about whether the charge
 * happened, and skipping on that basis is how a workflow double-charges.
 * @param entry - the recorded step.
 * @returns what a resumed run should do with it.
 */
export function decideResume(entry: JournalEntry): ResumeAction {
  if (entry.outcome !== 'completed') return { action: 'rerun', reason: 'not-completed' }
  if (entry.effectClass === 'side-effecting') {
    return { action: 'reconcile', receipts: entry.sideEffectReceipts }
  }
  if (!entry.verified) return { action: 'rerun', reason: 'completed-but-unverified' }
  if (entry.output === null) return { action: 'rerun', reason: 'completed-without-output' }
  return { action: 'skip', output: entry.output }
}

/** Why a journal may not be resumed at all. */
export type ResumeRefusalReason =
  /** The script's digest differs from the one the journal was written under. */
  | 'script-digest-changed'

/** Whether a whole journal may be resumed against a script. */
export type JournalAdmission =
  | { readonly resumable: true }
  | { readonly resumable: false; readonly reason: ResumeRefusalReason; readonly detail: string }

/**
 * Decide whether a journal may be resumed against a script at all
 * (acceptance[1]).
 *
 * A changed digest refuses the whole resume rather than degrading to a partial
 * one. Step ids are positions in a script, so against a different script they
 * name different work — resuming anyway would skip steps that were never run
 * and re-run steps that were, guided by a journal that no longer describes the
 * program. Migrating or restarting is the caller's choice; guessing is not
 * available.
 * @param journal - the journal to resume from.
 * @param scriptDigest - the digest of the script about to run.
 * @returns whether the resume may proceed.
 */
export function admitResume(journal: WorkflowJournal, scriptDigest: ScriptDigest): JournalAdmission {
  if (journal.scriptDigest !== scriptDigest) {
    return {
      resumable: false,
      reason: 'script-digest-changed',
      detail: `journal ${journal.scriptDigest} vs script ${scriptDigest}`,
    }
  }
  return { resumable: true }
}
