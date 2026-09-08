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
    const { reusable } = await reusableSteps(dir, 'run-1', SCRIPT, (childId) => {
      asked.push(childId)
      return Promise.resolve(true)
    }, undefined)

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

    expect((await reusableSteps(dir, 'run-1', SCRIPT, () => Promise.resolve(false), undefined)).reusable).toEqual({})
  })

  it('REFUSES the whole resume when the script changed (acceptance[1])', async () => {
    // Step ids are positions in a script. Against a different script they name
    // different work, so a partial resume would skip steps that never ran and
    // re-run steps that did.
    const dir = directory()
    writeJournal(dir, 'run-1', interrupted(scriptDigestOf(SCRIPT)))

    expect((await reusableSteps(dir, 'run-1', `${SCRIPT} // edited`, () => Promise.resolve(true), undefined)).reusable).toEqual({})
  })

  it('starts fresh when no journal was ever written, rather than failing', async () => {
    // "This run was never journalled" and "there is nothing to resume" are one
    // situation, and a caller asking to continue wants the run to happen.
    expect((await reusableSteps(directory(), 'run-never-seen', SCRIPT, () => Promise.resolve(true), undefined)).reusable).toEqual({})
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

    expect((await reusableSteps(dir, 'run-2', SCRIPT, childId => Promise.resolve(childId === 'child-one'), undefined)).reusable).toEqual({})
    expect((await reusableSteps(dir, 'run-2', SCRIPT, () => Promise.resolve(true), undefined)).reusable).toEqual({ 1: 'agent-result-1' })
  })

  it('round-trips a journal through the file, since a resume reads what a dead process wrote', async () => {
    const dir = directory()
    const journal = interrupted(scriptDigestOf(SCRIPT))
    writeJournal(dir, 'run-3', journal)
    expect(readJournal(dir, 'run-3')).toEqual(journal)
    expect(readJournal(dir, 'run-absent')).toBeUndefined()
  })
})

/**
 * A journal whose completed step recorded two external effects, with its
 * children confirmable, so the only thing under test is the ledger answer.
 */
function withEffects(digest: string, receipts: readonly string[]): WorkflowJournal {
  const journal = interrupted(digest)
  return {
    ...journal,
    entries: [{ ...journal.entries[0], sideEffectReceipts: receipts }],
  } as unknown as WorkflowJournal
}

const CONFIRMED_BOTH = { 'charge-1': 'confirmed', 'email-1': 'confirmed' } as const

describe('P4-08 must[2]: a side-effecting step is reconciled against the effect ledger', () => {
  it('reuses a step whose every side-effect receipt the ledger CONFIRMS, without re-running it', async () => {
    const dir = directory()
    writeJournal(dir, 'run-e1', withEffects(scriptDigestOf(SCRIPT), ['charge-1', 'email-1']))

    const asked: string[] = []
    const { reusable } = await reusableSteps(dir, 'run-e1', SCRIPT, () => Promise.resolve(true), (receipt) => {
      asked.push(receipt)
      return CONFIRMED_BOTH[receipt as keyof typeof CONFIRMED_BOTH]
    })

    // Reuse is the point, but so is that the ledger was consulted at all: the
    // clause this covers was previously true only inside a function nothing
    // called, and a reuse decided without asking would look identical here.
    expect(reusable).toEqual({ 1: 'agent-result-1' })
    expect(asked).toEqual(['charge-1', 'email-1'])
  })

  it('RERUNS a step whose side-effect receipts the ledger never reserved, because nothing left the harness', async () => {
    const dir = directory()
    writeJournal(dir, 'run-e2', withEffects(scriptDigestOf(SCRIPT), ['charge-1', 'email-1']))

    // No row and `prepared` are the same situation for a resume: the request
    // never went out, so running the step again cannot repeat anything.
    expect((await reusableSteps(dir, 'run-e2', SCRIPT, () => Promise.resolve(true), () => undefined)).reusable).toEqual({})
    expect((await reusableSteps(dir, 'run-e2', SCRIPT, () => Promise.resolve(true), () => 'prepared')).reusable).toEqual({})
  })

  it('ends the resume with ambiguous-reconciliation-required rather than deciding an unresolved effect', async () => {
    const dir = directory()
    writeJournal(dir, 'run-e3', withEffects(scriptDigestOf(SCRIPT), ['charge-1', 'email-1']))

    // `sent` is as undecidable as `ambiguous` here and for the same reason:
    // the request left the harness and no receipt came back, so a retry would
    // be a second attempt at an effect that may already have committed.
    for (const state of ['sent', 'ambiguous', 'compensated'] as const) {
      await expect(reusableSteps(dir, 'run-e3', SCRIPT, () => Promise.resolve(true), () => state))
        .rejects.toThrow(/ambiguous-reconciliation-required: step-1/u)
    }
  })

  it('refuses to reuse a step whose receipts are only PARTLY confirmed, since re-running would repeat the confirmed ones', async () => {
    const dir = directory()
    writeJournal(dir, 'run-e4', withEffects(scriptDigestOf(SCRIPT), ['charge-1', 'email-1']))

    // The failure this guards: a check that stopped at the first receipt, or
    // one that treated "not all confirmed" as "rerun", would repeat the charge.
    const error = await reusableSteps(dir, 'run-e4', SCRIPT, () => Promise.resolve(true), receipt => (receipt === 'charge-1' ? 'confirmed' : undefined))
      .then(() => undefined, (thrown: Error) => thrown)
    expect(error?.message).toContain('charge-1, email-1')
  })

  it('treats a step that recorded effects under no queryable scope as unreconcilable, not as reusable', async () => {
    const dir = directory()
    writeJournal(dir, 'run-e5', withEffects(scriptDigestOf(SCRIPT), ['charge-1']))

    // No ledger mounted, or a parent with no identity to scope the query by.
    // Answering `undefined` for every receipt would say "never reserved" and
    // rerun the charge; being unable to ask says nothing of the kind.
    await expect(reusableSteps(dir, 'run-e5', SCRIPT, () => Promise.resolve(true), undefined))
      .rejects.toThrow(/ambiguous-reconciliation-required/u)
  })

  it('refuses a step whose effects committed but whose children cannot be confirmed', async () => {
    const dir = directory()
    writeJournal(dir, 'run-e6', withEffects(scriptDigestOf(SCRIPT), ['charge-1']))

    // Undecidable in both directions: the rerun that an unconfirmed child asks
    // for would repeat a charge the ledger says committed.
    await expect(reusableSteps(dir, 'run-e6', SCRIPT, () => Promise.resolve(false), () => 'confirmed'))
      .rejects.toThrow(/ambiguous-reconciliation-required/u)
  })
})
