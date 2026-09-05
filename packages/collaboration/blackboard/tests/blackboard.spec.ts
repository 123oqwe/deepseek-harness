/**
 * P5-11 Usage stage: the blackboard, the mailbox, and receipt-driven task
 * advance.
 *
 * The pre-flight list put U's freeze here because U declares five SOURCE files
 * across three packages and no test file of its own. Two of those five are
 * pre-existing files that turned out to be name collisions, recorded in the
 * U-stage freeze note.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { admitFact, traceToObservations } from '../src/index.ts'
import type { ArtifactRef, AuthorId, Fact, FactId } from '../src/index.ts'
import { decideDelivery, deliveryKey } from '@deepseek-ai/dsh-mailbox'
import type { MessageId, Message, ParticipantId, SenderEpoch } from '@deepseek-ai/dsh-mailbox'
import { TaskStore } from '@deepseek-ai/dsh-taskboard'
import type { Task, TaskId, WorkerId } from '@deepseek-ai/dsh-taskboard'

const AUTHOR = brandString<AuthorId>('agent-1')

function fact(id: string, overrides: Partial<Fact> = {}): Fact {
  return {
    id: brandString<FactId>(id),
    author: AUTHOR,
    value: { kind: 'structured', value: { finding: 'x' } },
    provenance: { kind: 'observed', source: 'repo-scan' },
    postedAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  }
}

describe('P5-11 must[1]: the blackboard holds structured facts, never free text', () => {
  it('admits a structured value and a stored reference', () => {
    expect(admitFact(fact('f1'), new Set())).toEqual({ admitted: true })
    expect(admitFact(fact('f2', { value: { kind: 'ref', artifact: brandString<ArtifactRef>('artifact-1') } }), new Set()))
      .toEqual({ admitted: true })
  })

  it('refuses a bare string, an array and null, even when the type would allow them', () => {
    // The runtime check is the real guarantee: Record<string, unknown> is
    // satisfied by anything a cast produces, and the clause is about what the
    // board actually holds. An array of strings is as much free text as a
    // string, and admitting it would reopen the channel structure closes.
    for (const value of ['just some prose', ['a', 'b'], null]) {
      expect(admitFact(fact('f1', { value: { kind: 'structured', value: value as never } }), new Set()), String(value))
        .toEqual({ admitted: false, reason: 'unstructured-value' })
    }
  })

  it('requires an observed fact to name its source', () => {
    expect(admitFact(fact('f1', { provenance: { kind: 'observed', source: '' } }), new Set()))
      .toEqual({ admitted: false, reason: 'observed-without-source' })
  })

  it('requires a derived fact to name at least one source it can resolve', () => {
    expect(admitFact(fact('f2', { provenance: { kind: 'derived', from: [] } }), new Set()))
      .toEqual({ admitted: false, reason: 'derived-without-source' })
    expect(admitFact(fact('f2', { provenance: { kind: 'derived', from: [brandString<FactId>('ghost')] } }), new Set()))
      .toEqual({ admitted: false, reason: 'dangling-provenance' })
  })

  it('traces a derived conclusion back to its OBSERVATIONS, not its inputs', () => {
    // "Derived from fact 7" is not an answer if fact 7 was itself derived. A
    // caller judging a conclusion needs its roots.
    const root = fact('root', { provenance: { kind: 'observed', source: 'repo-scan' } })
    const middle = fact('middle', { provenance: { kind: 'derived', from: [root.id] } })
    const top = fact('top', { provenance: { kind: 'derived', from: [middle.id] } })
    const facts = new Map([root, middle, top].map(entry => [entry.id, entry]))

    expect(traceToObservations(top.id, facts).map(entry => entry.id)).toEqual([root.id])
  })

  it('collects every observation behind a fact derived from two branches', () => {
    const left = fact('left', { provenance: { kind: 'observed', source: 'scan-a' } })
    const right = fact('right', { provenance: { kind: 'observed', source: 'scan-b' } })
    const joined = fact('joined', { provenance: { kind: 'derived', from: [left.id, right.id] } })
    const facts = new Map([left, right, joined].map(entry => [entry.id, entry]))

    expect(traceToObservations(joined.id, facts).map(entry => entry.id)).toEqual([left.id, right.id])
  })
})

describe('P5-11: the mailbox delivers at most once', () => {
  function message(overrides: Partial<Message> = {}): Message {
    return {
      id: brandString<MessageId>('m1'),
      epoch: 1 as SenderEpoch,
      from: brandString<ParticipantId>('a'),
      to: brandString<ParticipantId>('b'),
      body: { text: 'x' },
      ...overrides,
    }
  }

  it('delivers a first arrival and drops a redelivery', () => {
    const recipient = brandString<ParticipantId>('b')
    const first = decideDelivery(message(), recipient, new Set())
    expect(first).toMatchObject({ action: 'deliver' })
    if (first.action !== 'deliver') throw new Error('unreachable')

    expect(decideDelivery(message(), recipient, new Set([first.key])))
      .toMatchObject({ action: 'drop', reason: 'duplicate' })
  })

  it('treats the same id at a new epoch as a NEW message', () => {
    const recipient = brandString<ParticipantId>('b')
    const seen = new Set([deliveryKey(message())])
    expect(decideDelivery(message({ epoch: 2 as SenderEpoch }), recipient, seen))
      .toMatchObject({ action: 'deliver' })
  })

  it('refuses a misdirected message WITHOUT consulting the seen-set', () => {
    // Address before dedup, for the reason recorded in dsh-message-bus:
    // consulting the seen-set for someone else's message would let a
    // misdirected message suppress a later legitimate one sharing its key.
    const seen = new Set([deliveryKey(message())])
    expect(decideDelivery(message(), brandString<ParticipantId>('someone-else'), seen))
      .toEqual({ action: 'refuse', reason: 'not-addressed-to-recipient' })
  })
})

describe('P5-11 acceptance[1]: the runtime advances a task from receipts', () => {
  function task(id: string, overrides: Partial<Task> = {}): Task {
    return {
      id: brandString<TaskId>(id), status: 'open', owner: null, attempt: 0,
      claimExpiresAtMs: null, outputs: [], verification: 'unverified', dependsOn: [], ...overrides,
    }
  }
  const WORKER = brandString<WorkerId>('w')

  function claimed(): TaskStore {
    const store = new TaskStore()
    store.submit([task('t1')])
    store.claim(brandString<TaskId>('t1'), WORKER, 1_000, 5_000)
    return store
  }

  it('advances claimed -> submitted -> verified with no model involvement', () => {
    const store = claimed()
    expect(store.applyReceipt({ taskId: brandString<TaskId>('t1'), worker: WORKER, attempt: 1, kind: 'submitted' }))
      .toMatchObject({ advanced: true, task: { status: 'submitted' } })
    expect(store.applyReceipt({ taskId: brandString<TaskId>('t1'), worker: WORKER, attempt: 1, kind: 'verified' }))
      .toMatchObject({ advanced: true, task: { status: 'verified', verification: 'passed' } })
  })

  it('refuses a receipt from a STALE attempt, so a reclaimed task is not overwritten', () => {
    // A worker whose claim lapsed can still finish and report. Accepting that
    // report would overwrite the new holder's task with the old holder's
    // result -- which is the entire reason receipts carry an attempt.
    const store = claimed()
    store.claim(brandString<TaskId>('t1'), brandString<WorkerId>('w2'), 6_001, 5_000)

    expect(store.applyReceipt({ taskId: brandString<TaskId>('t1'), worker: WORKER, attempt: 1, kind: 'submitted' }))
      .toEqual({ advanced: false, reason: 'not-owner' })
  })

  it('refuses an illegal advance, such as verifying work never submitted', () => {
    const store = claimed()
    expect(store.applyReceipt({ taskId: brandString<TaskId>('t1'), worker: WORKER, attempt: 1, kind: 'verified' }))
      .toEqual({ advanced: false, reason: 'illegal-advance' })
  })

  it('records the outputs a receipt carries', () => {
    const store = claimed()
    const outputs = [brandString('artifact-1')] as never
    expect(store.applyReceipt({ taskId: brandString<TaskId>('t1'), worker: WORKER, attempt: 1, kind: 'submitted', outputs }))
      .toMatchObject({ advanced: true, task: { outputs } })
  })

  it('refuses a receipt for an unknown task', () => {
    expect(new TaskStore().applyReceipt({ taskId: brandString<TaskId>('ghost'), worker: WORKER, attempt: 1, kind: 'submitted' }))
      .toEqual({ advanced: false, reason: 'unknown-task' })
  })
})
