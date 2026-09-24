/**
 * Where a journal lives between the crash and the resume (Epic P4-08 must[1],
 * acceptance[0]).
 *
 * **A journal held in memory answers nothing.** Every decision in this package
 * — skip, reconcile, refuse — is about a run that has already died, so the
 * record has to outlive the process that wrote it. Until this file, the
 * journal was written and never persisted, which made `planResume` a function
 * with no possible input.
 *
 * One file per run, replaced whole on every write. The journal is small (one
 * entry per step) and a partial write is worse than a stale one: a resume
 * reading half a record would believe steps it never saw had not started. The
 * write goes to a temporary name and renames, so a reader sees either the
 * previous journal or the new one.
 *
 * @module @deepseek-ai/dsh-workflow-journal/store
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkflowJournal } from './types.ts'

/** The on-disk name for one run's journal. */
const fileFor = (directory: string, runId: string): string => join(directory, `${runId}.json`)

/**
 * Persist one run's journal, replacing whatever was there.
 *
 * Synchronous, and that is the point rather than an oversight: the caller
 * writes after recording a step, and a deferred write would leave the window
 * this journal exists to close — the process dying with the step recorded only
 * in memory.
 * @param directory - the directory holding one file per run.
 * @param runId - the run this journal belongs to.
 * @param journal - the journal as it stands.
 */
export function writeJournal(directory: string, runId: string, journal: WorkflowJournal): void {
  // Owner-only, like a session log: a journal holds its children's outputs.
  // An existing directory keeps the mode it has.
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = fileFor(directory, runId)
  const temporary = `${target}.tmp`
  writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, target)
}

/**
 * Move one run's journal aside to `refused/<runId>.<suffix>.json`, so a run
 * that starts over under the same id cannot overwrite it. A resume refused for
 * a changed script does this before the new run first writes.
 * @param directory - the directory holding one file per run.
 * @param runId - the run whose journal is kept.
 * @param suffix - what tells this kept journal apart from another kept for the same run.
 */
export function setJournalAside(directory: string, runId: string, suffix: string): void {
  const aside = join(directory, 'refused')
  mkdirSync(aside, { recursive: true, mode: 0o700 })
  renameSync(fileFor(directory, runId), join(aside, `${runId}.${suffix}.json`))
}

/**
 * Read one run's journal.
 *
 * Absence is `undefined`, not an error: a run that never wrote one and a run
 * that was never started are the same thing to a caller asking whether there
 * is anything to resume. A file that exists and does not parse DOES throw —
 * that is corruption, and resuming from a guess about a corrupt journal is
 * exactly what `admitResume` refuses to do for a changed script.
 * @param directory - the directory holding one file per run.
 * @param runId - the run to read.
 * @returns the journal, or `undefined` when none was written.
 */
export function readJournal(directory: string, runId: string): WorkflowJournal | undefined {
  try {
    return JSON.parse(readFileSync(fileFor(directory, runId), 'utf8')) as WorkflowJournal
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
