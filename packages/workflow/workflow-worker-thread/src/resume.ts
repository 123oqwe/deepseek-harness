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
import type { ScriptDigest } from '@deepseek-ai/dsh-workflow-journal'

/** Whether one child session finished work, as its own log records it. */
export type ChildCompleted = (childId: string) => boolean

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
 * @returns recorded outputs by step sequence, for steps whose child is confirmed.
 */
export function reusableSteps(
  directory: string,
  runId: string,
  body: string,
  childCompleted: ChildCompleted,
): Record<number, string> {
  const journal = readJournal(directory, runId)
  if (journal === undefined) return {}
  const plan = planResume(journal, scriptDigestOf(body))
  if (!plan.resumable) return {}

  const reusable: Record<number, string> = {}
  for (const entry of journal.entries) {
    if (entry.outcome !== 'completed' || entry.output === null) continue
    // EVERY recorded child must be confirmed, not just the first. An entry
    // with several receipts is one step that started several children, and
    // reusing it while one of them is unaccounted for would skip work that
    // never finished.
    if (entry.childReceipts.length === 0) continue
    if (!entry.childReceipts.every(receipt => childCompleted(receipt))) continue
    const seq = Number(entry.stepId.replace(/^step-/u, ''))
    if (Number.isSafeInteger(seq) && seq > 0) reusable[seq] = entry.output
  }
  return reusable
}
