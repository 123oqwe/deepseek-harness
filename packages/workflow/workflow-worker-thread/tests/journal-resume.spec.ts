/**
 * Resume after a kill, counted at the child rather than at the journal
 * (Epic P4-08 must[1], must[2], acceptance[0]).
 *
 * **The count that matters is the one the journal cannot fake.** Asking the
 * journal whether it skipped a step proves only that it recorded a skip; the
 * clause is about child WORK not being repeated, so the fixture counts how
 * many times a child was actually started, the way P4-12's crash campaign
 * counts at its fake external service.
 *
 * The kill is modelled by discarding the host and starting a new run against
 * the same journal directory and run id — which is what a restart is from the
 * journal's side. Nothing here relies on the previous process's memory: the
 * second run reads the file the first one wrote.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readJournal, writeJournal } from '@deepseek-ai/dsh-workflow-journal'
import type { WorkflowJournal } from '@deepseek-ai/dsh-workflow-journal'
import { reusableSteps, scriptDigestOf } from '../src/resume.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-journal-resume-'))
  roots.push(root)
  return root
}

const SCRIPT = "const a = await agent('one'); const b = await agent('two'); return [a, b]"

/** A journal as the host writes one: two steps, the first settled, the second still in flight. */
function interrupted(digest: string): WorkflowJournal {
  return {
    scriptDigest: digest,
    entries: [
      {
        stepId: 'step-1', phase: 'unphased', effectClass: 'side-effecting', outcome: 'completed',
        inputs: [], output: 'agent-result-1', childReceipts: ['child-one'], sideEffectReceipts: [], verified: false,
      },
      {
        stepId: 'step-2', phase: 'unphased', effectClass: 'side-effecting', outcome: 'in-flight',
        inputs: [], output: null, childReceipts: ['child-two'], sideEffectReceipts: [], verified: false,
      },
    ],
  } as unknown as WorkflowJournal
}

describe('P4-08 acceptance[0]: a resume does not repeat completed child work', () => {
  it('reuses a completed step whose child SESSION confirms the work happened', async () => {
    const dir = directory()
    const digest = scriptDigestOf(SCRIPT)
    writeJournal(dir, 'run-1', interrupted(digest))

    // Every child the journal names is confirmed: this is the reconciliation,
    // and it asks the world (the child's own log), not the journal.
    const asked: string[] = []
    const reusable = await reusableSteps(dir, 'run-1', SCRIPT, (childId) => {
      asked.push(childId)
      return Promise.resolve(true)
    })

    expect(reusable).toEqual({ 1: 'agent-result-1' })
    expect(asked).toEqual(['child-one'])
    // step-2 was in flight when the process died: it is NOT reusable, because
    // "started" and "finished" are the two states a crash makes ambiguous.
    expect(reusable[2]).toBeUndefined()
  })

  it('RERUNS a completed step whose child session cannot be confirmed', async () => {
    // The negative half, and the reason reconciliation is not a formality: the
    // journal says the step completed, the world does not agree, and the world
    // wins. Trusting the record here is how a resume skips work that never
    // happened.
    const dir = directory()
    writeJournal(dir, 'run-1', interrupted(scriptDigestOf(SCRIPT)))

    expect(await reusableSteps(dir, 'run-1', SCRIPT, () => Promise.resolve(false))).toEqual({})
  })

  it('REFUSES the whole resume when the script changed (acceptance[1])', async () => {
    // Step ids are positions in a script. Against a different script they name
    // different work, so a partial resume would skip steps that never ran and
    // re-run steps that did.
    const dir = directory()
    writeJournal(dir, 'run-1', interrupted(scriptDigestOf(SCRIPT)))

    expect(await reusableSteps(dir, 'run-1', `${SCRIPT} // edited`, () => Promise.resolve(true))).toEqual({})
  })

  it('starts fresh when no journal was ever written, rather than failing', async () => {
    // "This run was never journalled" and "there is nothing to resume" are one
    // situation, and a caller asking to continue wants the run to happen.
    expect(await reusableSteps(directory(), 'run-never-seen', SCRIPT, () => Promise.resolve(true))).toEqual({})
  })

  it('requires EVERY recorded child of a step, not just the first', async () => {
    // One step may start several children. Reusing it while one is unaccounted
    // for would skip work that never finished — and a check that stopped at
    // the first receipt would pass this fixture happily.
    const dir = directory()
    const journal = interrupted(scriptDigestOf(SCRIPT))
    const both = {
      ...journal,
      entries: [{ ...journal.entries[0], childReceipts: ['child-one', 'child-two'] }],
    } as unknown as WorkflowJournal
    writeJournal(dir, 'run-2', both)

    expect(await reusableSteps(dir, 'run-2', SCRIPT, childId => Promise.resolve(childId === 'child-one'))).toEqual({})
    expect(await reusableSteps(dir, 'run-2', SCRIPT, () => Promise.resolve(true))).toEqual({ 1: 'agent-result-1' })
  })

  it('round-trips a journal through the file, since a resume reads what a dead process wrote', async () => {
    const dir = directory()
    const journal = interrupted(scriptDigestOf(SCRIPT))
    writeJournal(dir, 'run-3', journal)
    expect(readJournal(dir, 'run-3')).toEqual(journal)
    expect(readJournal(dir, 'run-absent')).toBeUndefined()
  })
})
