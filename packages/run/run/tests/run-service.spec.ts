/**
 * Provider-stage RED scaffold for Epic P4-01's first-class Run Service:
 * `../src/index.ts`'s `RunService` and its `createFileRunStore` durability
 * seam, exercised through the real registered API only — every case below
 * constructs the service the one way production does
 * (`RunService.restore(store)`) over a real on-disk store file, never a
 * parallel in-test registry.
 *
 * A "process restart" here is a fresh `createFileRunStore` over the same
 * path handed to a fresh `RunService.restore` — no value, map, or closure is
 * shared between the two services, so a Run that reappears did so from the
 * durable bytes and nowhere else. That is exactly acceptance[0]'s claim, and
 * exactly the claim Contract stage could not make: `listNonTerminalRuns`
 * and `resumeRun` there take a plain array a caller already holds, which a
 * restart is precisely the event that destroys.
 *
 * Every function under test currently throws `'not implemented: ...'`
 * (`../src/index.ts`), so every case fails on that today; the assertions
 * describe the behavior a later fix-round must satisfy.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { RunId } from '@deepseek-ai/dsh-principal/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileRunStore, RunService } from '../src/index.ts'
import { RUN_SERVICE_OWNER_ID } from '../src/state-machine.ts'
import { RunEventSeq } from '../src/types.ts'
import type { ArtifactRef, Run } from '../src/types.ts'

const RUN_A = RunId('run-a')
const RUN_B = RunId('run-b')
const SESSION_1 = SessionId('session-1')
const SESSION_2 = SessionId('session-2')
const ARTIFACT = brandString<ArtifactRef>('artifact-1')

let dir: string
let storePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-run-service-'))
  storePath = join(dir, 'runs.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Boot a service exactly the way a fresh process does: a new store, a new registry. */
async function boot(): Promise<RunService> {
  return await RunService.restore(createFileRunStore(storePath))
}

describe('acceptance[0]: after a process restart, every non-terminal Run can be listed and resumed', () => {
  it('lists a non-terminal Run reconstructed from the durable store by a fresh service', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    expect((await first.advance(RUN_A, 'planning', [], 1_100)).accepted).toBe(true)

    const restarted = await boot()
    expect(restarted.listNonTerminal().map(run => run.id)).toEqual([RUN_A])
  })

  it('lists every non-terminal Run, not just the most recently written one', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    await first.accept(RUN_B, SESSION_2, 2_000)

    const restarted = await boot()
    expect([...restarted.listNonTerminal()].map(run => run.id).sort()).toEqual([RUN_A, RUN_B])
  })

  it('omits a Run that reached a terminal state before the restart from the non-terminal listing', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    await first.accept(RUN_B, SESSION_2, 2_000)
    expect((await first.advance(RUN_B, 'cancelled', [], 2_100)).accepted).toBe(true)

    const restarted = await boot()
    expect(restarted.listNonTerminal().map(run => run.id)).toEqual([RUN_A])
    // The terminal Run is still registered — omitted from the listing, not lost.
    expect(restarted.get(RUN_B)?.state).toBe('cancelled')
  })

  it('resumes a non-terminal Run reconstructed after a restart', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    expect((await first.advance(RUN_A, 'planning', [], 1_100)).accepted).toBe(true)

    const restarted = await boot()
    const decision = restarted.resume(RUN_A)
    expect(decision.resumed).toBe(true)
    if (!decision.resumed) return
    expect(decision.run.state).toBe('planning')
  })

  it('refuses to resume a Run that reached a terminal state before the restart', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    expect((await first.advance(RUN_A, 'cancelled', [], 1_100)).accepted).toBe(true)

    const restarted = await boot()
    expect(restarted.resume(RUN_A)).toEqual({ resumed: false, reason: 'already-terminal' })
  })

  it('reconstructs a restored Run exactly, brands included, not an approximation of it', async () => {
    const first = await boot()
    const accepted = await first.accept(RUN_A, SESSION_1, 1_000)

    const restarted = await boot()
    const expected: Run = {
      id: RUN_A,
      state: 'accepted',
      ownerId: RUN_SERVICE_OWNER_ID,
      sessionIds: [SESSION_1],
      createdAt: 1_000,
      events: [{
        seq: RunEventSeq(0),
        runId: RUN_A,
        occurredAt: 1_000,
        fromState: null,
        toState: 'accepted',
        references: [{ kind: 'session', id: SESSION_1 }],
      }],
    }
    expect(restarted.get(RUN_A)).toEqual(expected)
    expect(restarted.get(RUN_A)).toEqual(accepted)
  })

  it('starts empty on a first boot, with no store file on disk yet', async () => {
    const fresh = await boot()
    expect(fresh.listNonTerminal()).toEqual([])
    expect(fresh.get(RUN_A)).toBeUndefined()
  })
})

describe('acceptance[1]: illegal state transitions are rejected', () => {
  it('accepts a legal transition through the service and durably records the new state', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    const decision = await first.advance(RUN_A, 'planning', [], 1_100)
    expect(decision.accepted).toBe(true)

    const restarted = await boot()
    expect(restarted.get(RUN_A)?.state).toBe('planning')
  })

  it('rejects an illegal transition through the service, naming the exact rejected pair', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    expect(await first.advance(RUN_A, 'succeeded', [], 1_100)).toEqual({
      accepted: false,
      reason: 'illegal-transition',
      from: 'accepted',
      to: 'succeeded',
    })
  })

  it('writes nothing for a rejected transition: the restored Run keeps its state and its unextended event log', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    expect((await first.advance(RUN_A, 'succeeded', [], 1_100)).accepted).toBe(false)

    const restarted = await boot()
    const run = restarted.get(RUN_A)
    expect(run?.state).toBe('accepted')
    expect(run?.events).toHaveLength(1)
  })
})

describe('acceptance[2]: one Session associates with multiple Runs, one Run spans multiple Sessions/Agents', () => {
  it('associates one Session with multiple Runs across a restart', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    await first.accept(RUN_B, SESSION_1, 2_000)

    const restarted = await boot()
    expect([...restarted.runsForSession(SESSION_1)].map(run => run.id).sort()).toEqual([RUN_A, RUN_B])
  })

  it('lists no Run for a Session that never initiated or joined one', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)

    const restarted = await boot()
    expect(restarted.runsForSession(SESSION_2)).toEqual([])
  })

  it('spans one Run across multiple Sessions durably: an attached Session survives a restart', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    await first.attachSession(RUN_A, SESSION_2)

    const restarted = await boot()
    expect(restarted.get(RUN_A)?.sessionIds).toEqual([SESSION_1, SESSION_2])
    expect(restarted.runsForSession(SESSION_2).map(run => run.id)).toEqual([RUN_A])
  })
})

describe('must[1]: the Run event log is append-only and references other entities', () => {
  it('appends across a restart without rewriting or reordering any earlier entry', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    expect((await first.advance(RUN_A, 'planning', [], 1_100)).accepted).toBe(true)
    const beforeRestart = first.get(RUN_A)?.events

    const restarted = await boot()
    expect((await restarted.advance(RUN_A, 'running', [{ kind: 'artifact', id: ARTIFACT }], 1_200)).accepted).toBe(true)

    const afterAppend = restarted.get(RUN_A)?.events ?? []
    expect(afterAppend.slice(0, 2)).toEqual(beforeRestart)
    expect(afterAppend).toHaveLength(3)
    expect(afterAppend[2]).toEqual({
      seq: RunEventSeq(2),
      runId: RUN_A,
      occurredAt: 1_200,
      fromState: 'planning',
      toState: 'running',
      references: [{ kind: 'artifact', id: ARTIFACT }],
    })
  })

  it('restores a log entry\'s entity references, not just its state pair', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)
    expect((await first.advance(RUN_A, 'planning', [{ kind: 'artifact', id: ARTIFACT }], 1_100)).accepted).toBe(true)

    const restarted = await boot()
    expect(restarted.get(RUN_A)?.events[1]?.references).toEqual([{ kind: 'artifact', id: ARTIFACT }])
  })
})

describe('must[2]: the Run is owned by the service itself, never a UI session or turn holder', () => {
  it('owns a Run restored after a restart with RUN_SERVICE_OWNER_ID, never the initiating SessionId', async () => {
    const first = await boot()
    await first.accept(RUN_A, SESSION_1, 1_000)

    const restarted = await boot()
    expect(restarted.get(RUN_A)?.ownerId).toBe(RUN_SERVICE_OWNER_ID)
    expect(restarted.get(RUN_A)?.ownerId).not.toBe(SESSION_1)
  })
})

describe('createFileRunStore: the durability seam itself', () => {
  it('reads back exactly what a separate store instance over the same path wrote', async () => {
    const service = await boot()
    const accepted = await service.accept(RUN_A, SESSION_1, 1_000)

    const second = createFileRunStore(storePath)
    expect(await second.loadAll()).toEqual([accepted])
  })

  it('reports no Runs for a path that has never been written to, rather than failing', async () => {
    const store = createFileRunStore(join(dir, 'never-written.json'))
    expect(await store.loadAll()).toEqual([])
  })

  it('writes the Run to the named path, not somewhere else', async () => {
    const service = await boot()
    await service.accept(RUN_A, SESSION_1, 1_000)
    expect(await readFile(storePath, 'utf8')).toContain(RUN_A)
  })
})
