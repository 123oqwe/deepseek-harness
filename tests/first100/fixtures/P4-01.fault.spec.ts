/**
 * P4-01 F-stage fault qualification: the durable Run registry
 * (`@deepseek-ai/dsh-run`'s `RunService` and `createFileRunStore`) put under
 * the conditions the Contract, Provider and Usage stages never subjected it
 * to — concurrent writers over one Run, two services over one store path, and
 * a store document that is damaged rather than clean.
 *
 * Provider stage proved acceptance[0] ("after a process restart, every
 * non-terminal Run can be listed and resumed") over a store this repository's
 * own code had written and nothing had disturbed. That is the happy path, and
 * the happy path was never the risk: a registry is asked to restart precisely
 * when something went wrong, so the store it reads is exactly the one most
 * likely to be damaged. Every case below therefore damages the store, or races
 * the writers, before asking the registry to restore.
 *
 * Four cases fail against the code as landed and name a real defect the
 * fix-round closes. Three are marked `CHARACTERIZATION:` and pass already:
 * they pin fault handling that is correct today so a later change cannot
 * silently regress it, following the `control:` precedent for cases that pass
 * at RED by design.
 *
 * Every assertion is on observable Run state or on a rejection this repository
 * raises itself. None reads an OS errno, a temp-file name, or a `rename`
 * result, so no case can pass on macOS while being false on Linux.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunId } from '@deepseek-ai/dsh-principal/types'
import { createFileRunStore, RunService } from '@deepseek-ai/dsh-run'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const RUN_A = RunId('run-a')
const RUN_B = RunId('run-b')
const SESSION_1 = SessionId('session-1')
const SESSION_2 = SessionId('session-2')

/** The store document shape this fixture writes by hand to damage a store. */
interface StoreDocument {
  version: number
  runs: { id: string; state: string; ownerId: string; sessionIds: string[]; createdAt: number; events: { seq: number }[] }[]
}

let dir: string
let storePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-run-fault-'))
  storePath = join(dir, 'runs.json')
})

afterEach(async () => {
  // Specs run concurrently in forked workers, so this file owns every path it
  // created through teardown rather than sharing a fixed location.
  await rm(dir, { recursive: true, force: true })
})

/** Boot a service exactly the way a fresh process does: a new store, a new registry. */
async function boot(): Promise<RunService> {
  return await RunService.restore(createFileRunStore(storePath))
}

/** Read the store document this fixture is about to damage. */
async function readDocument(): Promise<StoreDocument> {
  return JSON.parse(await readFile(storePath, 'utf8')) as StoreDocument
}

describe('P4-01 Fault — must[1]/acceptance[1]: concurrent writers never lose an accepted transition or admit two exits from one state', () => {
  it('two concurrent transitions out of one state never both succeed, and the durable log records exactly the accepted one', async () => {
    const service = await boot()
    await service.accept(RUN_A, SESSION_1, 1_000)
    expect((await service.advance(RUN_A, 'planning', [], 1_100)).accepted).toBe(true)
    expect((await service.advance(RUN_A, 'running', [], 1_200)).accepted).toBe(true)
    expect((await service.advance(RUN_A, 'verifying', [], 1_300)).accepted).toBe(true)

    // `succeeded` and `failed` are both legal out of `verifying` and both
    // terminal, so whichever is applied first makes the other illegal — in
    // either order exactly one may be accepted.
    const decisions = await Promise.all([
      service.advance(RUN_A, 'succeeded', [], 1_400),
      service.advance(RUN_A, 'failed', [], 1_400),
    ])

    const accepted = decisions.filter(decision => decision.accepted)
    expect(accepted).toHaveLength(1)
    const rejected = decisions.filter(decision => !decision.accepted)
    expect(rejected).toHaveLength(1)

    const winner = accepted[0]
    if (winner === undefined || !winner.accepted) return
    const [loser] = rejected
    if (loser !== undefined && !loser.accepted) {
      expect(loser.reason).toBe('illegal-transition')
      // The refusal names the state the winner had already moved the Run to,
      // which is the observable evidence that the loser was decided after the
      // winner was applied rather than against the same pre-transition value.
      expect(loser.from).toBe(winner.run.state)
    }

    const restarted = await boot()
    const run = restarted.get(RUN_A)
    expect(run?.state).toBe(winner.run.state)
    // The append-only log carries the genesis entry plus one entry per
    // accepted transition, at contiguous ascending seqs — a transition the
    // service accepted is never missing from it.
    expect(run?.events).toHaveLength(5)
    expect(run?.events.map(event => Number(event.seq))).toEqual([0, 1, 2, 3, 4])
  })
})

describe('P4-01 Fault — acceptance[0]: a restart survives two writers over one store path', () => {
  it('two services over one store path both durably record their Run, losing neither', async () => {
    const first = await boot()
    const second = await boot()

    await Promise.all([
      first.accept(RUN_A, SESSION_1, 1_000),
      second.accept(RUN_B, SESSION_2, 2_000),
    ])

    const restarted = await boot()
    expect([...restarted.listNonTerminal()].map(run => run.id).sort()).toEqual([RUN_A, RUN_B])
  })
})

describe('P4-01 Fault — acceptance[0]: a damaged store document is refused, never restored into the registry', () => {
  it('a store document naming a Run state outside the closed set is refused, never restored and offered for resumption', async () => {
    const seeded = await boot()
    await seeded.accept(RUN_A, SESSION_1, 1_000)
    const document = await readDocument()
    // must[0]'s Run-state set is closed; `not-a-state` is outside it, and a
    // Run in no state at all must never reach `listNonTerminal`/`resume`.
    document.runs[0]!.state = 'not-a-state'
    document.runs[0]!.ownerId = 'some-ui-session'
    await writeFile(storePath, JSON.stringify(document), 'utf8')

    await expect(boot()).rejects.toThrow(/not-a-state/)
  })

  it('a store document whose event log has a seq gap is refused, never appended onto with a backwards seq', async () => {
    const seeded = await boot()
    await seeded.accept(RUN_A, SESSION_1, 1_000)
    const document = await readDocument()
    // The genesis entry is always seq 0; a log starting at 7 has lost entries,
    // and appending onto it mints a seq below one already present.
    document.runs[0]!.events[0]!.seq = 7
    await writeFile(storePath, JSON.stringify(document), 'utf8')

    await expect(boot()).rejects.toThrow(/seq/)
  })
})

describe('P4-01 Fault — acceptance[0]: an unreadable store fails loud rather than restoring an empty registry', () => {
  it('CHARACTERIZATION: a corrupt store document is refused loudly, never read as an empty registry', async () => {
    await writeFile(storePath, '{ not json', 'utf8')
    // Reading a corrupt store as "no Runs yet" would silently discard every
    // non-terminal Run acceptance[0] promises to list.
    await expect(boot()).rejects.toThrow()
  })

  it('CHARACTERIZATION: a store document written under an unsupported format version is refused, naming the version', async () => {
    await writeFile(storePath, JSON.stringify({ version: 99, runs: [] }), 'utf8')
    await expect(boot()).rejects.toThrow(/unsupported Run store format version 99/)
  })

  it('CHARACTERIZATION: a leftover temp file from an interrupted write is ignored, and the complete document still restores', async () => {
    const seeded = await boot()
    await seeded.accept(RUN_A, SESSION_1, 1_000)
    // Write-temp-then-rename leaves the previous complete document in place at
    // the store path; an interrupted write's residue must not be read as one.
    await writeFile(`${storePath}.${String(process.pid)}.tmp`, 'a partially written document', 'utf8')

    const restarted = await boot()
    expect(restarted.listNonTerminal().map(run => run.id)).toEqual([RUN_A])
  })
})
