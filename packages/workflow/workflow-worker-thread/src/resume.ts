/**
 * What a resumed run may reuse, and how that is decided (Epic P4-08 must[1],
 * must[2], acceptance[0]).
 *
 * **Reuse here is reconciliation, not a skip.** `decideResume` classifies every
 * `agent()` step `side-effecting` — a child may have written files, sent
 * messages or spent money — so the journal alone never authorizes reusing one.
 * What authorizes it is checking the world: the child's own durable session.
 * If that session exists and closed a turn, the work happened, and re-running
 * the step would do it twice; if it does not, the step reruns.
 *
 * That is why this module needs a session lookup rather than only a journal.
 * A resume decided from the journal by itself would be trusting the record of
 * an interrupted process about what it managed to finish, which is exactly the
 * claim the interruption puts in doubt.
 *
 * @module @deepseek-ai/dsh-workflow-worker-thread/resume
 */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { planResume, readJournal } from '@deepseek-ai/dsh-workflow-journal'
import type { ScriptDigest, WorkflowJournal } from '@deepseek-ai/dsh-workflow-journal'
import type { LedgerState } from '@deepseek-ai/dsh-action-ledger'

/**
 * Whether one child session finished work, as its own DURABLE log records it.
 *
 * Asynchronous because the answer has to survive the crash: a settled run
 * disposes its children, so the live registry answers `false` for every child
 * after a restart and a resume reading it would never reuse anything —
 * satisfying acceptance[0] by doing nothing, which is its vacuous reading.
 */
export type ChildCompleted = (childId: string) => Promise<boolean>

/**
 * What the effect ledger knows about one recorded side-effect receipt.
 *
 * `undefined` means the ledger holds no row for it, which is a real answer:
 * the effect was never reserved, so it never left the harness. A caller that
 * cannot query a ledger at all passes no lookup rather than a function that
 * answers `undefined`, because "never reserved" and "unable to ask" authorize
 * opposite decisions.
 */
export type EffectStateLookup = (receipt: string) => LedgerState | undefined

/**
 * What reconciling one step's side-effect receipts against the ledger settles
 * (must[2]).
 */
type Reconciliation =
  /** Every receipt is `confirmed`: the effects happened, so the step must NOT run again. */
  | 'confirmed'
  /** No receipt got past `prepared`: nothing left the harness, so the step reruns. */
  | 'never-sent'
  /** Neither of the above can be established; a resume may not decide this alone. */
  | 'unresolved'

/**
 * Reconcile one step's side-effect receipts against the effect ledger.
 *
 * `sent`, `ambiguous` and `compensated` are all `unresolved` here, and so is
 * any MIXTURE of confirmed and unreserved receipts. Only two situations let a
 * resume act by itself: every effect provably committed, or provably none did.
 * A step that half-committed cannot be rerun without repeating the committed
 * half and cannot be reused without dropping the other, which is the case
 * P4-12 sends to reconciliation rather than resolving by retrying.
 * @param receipts - the step's recorded side-effect receipts; never empty here.
 * @param lookup - the ledger query, absent when this run has no ledger to ask.
 * @returns what the resume may conclude.
 */
function reconcileEffects(receipts: readonly string[], lookup: EffectStateLookup | undefined): Reconciliation {
  if (lookup === undefined) return 'unresolved'
  const states = receipts.map(receipt => lookup(receipt))
  if (states.every(state => state === 'confirmed')) return 'confirmed'
  if (states.every(state => state === undefined || state === 'prepared')) return 'never-sent'
  return 'unresolved'
}

/**
 * A resume that stopped because an external effect's outcome is not decidable
 * from the ledger (must[2]).
 *
 * Thrown rather than returned so no caller can continue past it by ignoring a
 * field: the alternative to reconciling is repeating or dropping an effect
 * that reached the world. The receipts are carried so the operator handling it
 * knows which entries to reconcile.
 */
export class AmbiguousReconciliationRequiredError extends Error {
  /**
   * @param stepId - the journal entry that could not be reconciled.
   * @param receipts - its side-effect receipts, for the operator to reconcile.
   */
  constructor(readonly stepId: string, readonly receipts: readonly string[]) {
    super(`ambiguous-reconciliation-required: ${stepId} recorded side effects whose outcome the ledger does not settle (${receipts.join(', ')})`)
  }
}

/**
 * What a resume concluded about the journal it read.
 *
 * The journal comes back with the outputs because the resumed run has to
 * CONTINUE it rather than start a fresh one: a second recorder seeded from
 * nothing overwrites the file on its first persist, and the steps this resume
 * just reconciled would vanish from the record that exists to remember them.
 * Absent when there is nothing to continue — no journal, or one the script
 * digest refuses.
 */
export interface Reconciled {
  /** Recorded outputs by 1-based step sequence, for steps this resume reconciled. */
  readonly reusable: Record<number, string>
  /** The journal these were read from, for the resumed run's recorder to continue. */
  readonly journal: WorkflowJournal | undefined
}

/**
 * The digest a journal is written under and compared against.
 *
 * SHA-256 of the script body, which makes it sensitive to comments and
 * whitespace. That is blunt and deliberately so: acceptance[1] refuses a
 * resume whose script changed, and refusing a cosmetic edit costs one re-run
 * while admitting a semantic one costs a wrong resume.
 * @param body - the script body.
 * @returns its digest.
 */
export function scriptDigestOf(body: string): ScriptDigest {
  return brandString<ScriptDigest>(createHash('sha256').update(body).digest('hex'))
}

/**
 * Which steps a resumed run may reuse, by 1-based `agent()` sequence.
 *
 * Empty when there is no journal, when the script changed, or when nothing was
 * reconcilable — and all three mean the same thing to the caller: run it. A
 * missing journal is not an error, because "this run was never journalled" and
 * "there is nothing to resume" are one situation.
 * @param directory - the directory holding one journal file per run.
 * @param runId - the run being resumed.
 * @param body - the script about to run, whose digest must match the journal's.
 * @param childCompleted - whether a recorded child's session shows finished work.
 * @param effectState - the ledger query for recorded side effects, absent when this run has no ledger to ask.
 * @returns the reconciliation: reusable outputs by step sequence, and the journal they were read from.
 * @throws AmbiguousReconciliationRequiredError when a step's recorded side effects are neither provably committed nor provably unsent.
 */
export async function reusableSteps(
  directory: string,
  runId: string,
  body: string,
  childCompleted: ChildCompleted,
  effectState: EffectStateLookup | undefined,
): Promise<Reconciled> {
  const journal = readJournal(directory, runId)
  if (journal === undefined) return { reusable: {}, journal: undefined }
  const plan = planResume(journal, scriptDigestOf(body))
  if (!plan.resumable) return { reusable: {}, journal: undefined }

  const reusable: Record<number, string> = {}
  for (const entry of journal.entries) {
    if (entry.outcome !== 'completed' || entry.output === null) continue
    // Recorded side effects are reconciled BEFORE the children are counted,
    // because every failure answer below is "run it again" and that is exactly
    // what a committed external effect forbids. A step with no recorded
    // receipts skips this entirely and is decided as it always was.
    const reconciliation: Reconciliation | 'no-effects' = entry.sideEffectReceipts.length === 0
      ? 'no-effects'
      : reconcileEffects(entry.sideEffectReceipts, effectState)
    if (reconciliation === 'unresolved') {
      throw new AmbiguousReconciliationRequiredError(entry.stepId, entry.sideEffectReceipts)
    }
    // Nothing left the harness, so the step reruns whatever the journal says
    // about its output: that output is a claim about a world nothing reached.
    if (reconciliation === 'never-sent') continue
    // EVERY recorded child must be confirmed, not just the first. An entry
    // with several receipts is one step that started several children, and
    // reusing it while one of them is unaccounted for would skip work that
    // never finished.
    const childrenConfirmed = entry.childReceipts.length > 0
      && (await Promise.all(entry.childReceipts.map(receipt => childCompleted(receipt)))).every(Boolean)
    if (!childrenConfirmed) {
      // A step whose effects committed but whose children cannot be confirmed
      // is decidable in neither direction: rerunning repeats the effects,
      // reusing publishes an output no finished child stands behind.
      if (reconciliation === 'confirmed') throw new AmbiguousReconciliationRequiredError(entry.stepId, entry.sideEffectReceipts)
      continue
    }
    const seq = Number(entry.stepId.replace(/^step-/u, ''))
    if (Number.isSafeInteger(seq) && seq > 0) reusable[seq] = entry.output
  }
  return { reusable, journal }
}
