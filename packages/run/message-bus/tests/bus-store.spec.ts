/**
 * P4-06 must[0]: the domain event, its outbox row and the inbox claim commit
 * in ONE SQLite transaction.
 *
 * The reworded clause (C13) names the mechanism: one `BEGIN IMMEDIATE`, not
 * through the storage KV seam. Measured before this was written —
 * `BEGIN IMMEDIATE` appears exactly once in the repository, in the session
 * search index, and nothing on the message path used it. The previous durable
 * path was a JSONL batch, which BLOCKED-089 measured as atomic against a write
 * ERROR and not against a crash: recovery truncates to the last complete
 * record, so a domain event could survive while its outbox row was dropped —
 * the unrecoverable direction, because replay cannot repair a message it
 * cannot find.
 *
 * The inbox's state machine is what keeps BLOCKED-088's case legal. The rule
 * that preceded it treated `claimed` as terminal, which forbade
 * `goal-round-driver`'s deliberate restoration of a claimed message whose
 * reservation had gone stale — a turn that never ran and produced no effect.
 * Under `claimed | consumed | released`, that restoration is a released row
 * being re-claimed rather than a transition out of a terminal state.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commitIntake, openBusStore, recoverStaleClaims } from '../src/bus-store.ts'
import type { BusStore } from '../src/bus-store.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function store(): BusStore {
  const dir = mkdtempSync(join(tmpdir(), 'bus-store-'))
  roots.push(dir)
  return openBusStore(dir)
}

/** One arriving message in CloudEvents attribute names, which this epic owns. */
const message = (id: string, epoch = 1) => ({
  id,
  source: '/dsh/test',
  type: 'dsh.test.event',
  time: '2026-09-07T00:00:00.000Z',
  subject: 'subject-1',
  datacontenttype: 'application/json',
  epoch,
  data: { n: 1 },
})

describe('P4-06 must[0]: one BEGIN IMMEDIATE covers the domain event, the outbox row and the inbox claim', () => {
  it('commits all three together, so a consumed message has both an outbox row and a domain event', () => {
    const bus = store()
    commitIntake(bus, { message: message('m1'), claimedByTurn: 7, outbox: [{ target: 'peer', payload: { n: 1 } }] })
    expect(bus.domainEvents()).toHaveLength(1)
    expect(bus.outboxRows()).toHaveLength(1)
    expect(bus.inboxRow('m1', 1)?.state).toBe('consumed')
  })

  it('writes NOTHING when the commit fails partway, rather than the domain event without its outbox row', () => {
    // The direction BLOCKED-089 called unrecoverable: replay cannot repair a
    // message it cannot find, so a domain event surviving alone is worse than
    // neither surviving.
    const bus = store()
    expect(() => {
      commitIntake(bus, {
        message: message('m2'),
        claimedByTurn: 7,
        outbox: [{ target: 'peer', payload: { n: 1 } }],
        failAt: 'after-domain-event',
      })
    }).toThrow()
    expect(bus.domainEvents()).toHaveLength(0)
    expect(bus.outboxRows()).toHaveLength(0)
    expect(bus.inboxRow('m2', 1)).toBeUndefined()
  })

  it('writes nothing when the commit fails AFTER the outbox rows, which a sequential writer could not survive', () => {
    // The second failure point, and the one that separates a transaction from
    // a plain sequence of writes. Failing only at the FIRST step is satisfied
    // by a writer that stops on error and never wrote anything after it;
    // failing here requires statements already executed to be rolled back.
    const bus = store()
    expect(() => {
      commitIntake(bus, {
        message: message('m2b'),
        claimedByTurn: 7,
        outbox: [{ target: 'peer', payload: { n: 1 } }],
        failAt: 'after-outbox',
      })
    }).toThrow()
    expect(bus.domainEvents()).toHaveLength(0)
    expect(bus.outboxRows()).toHaveLength(0)
    expect(bus.inboxRow('m2b', 1)).toBeUndefined()
  })
})

describe('P4-06 must[2]: the inbox state machine keeps a stale claim recoverable (BLOCKED-088)', () => {
  it('leaves a crashed claim in `claimed`, not `consumed`', () => {
    const bus = store()
    bus.claim(message('m3'), 9)
    expect(bus.inboxRow('m3', 1)?.state).toBe('claimed')
  })

  it('sweeps an expired claim to `released`, so the turn that never ran does not consume the message', () => {
    const bus = store()
    bus.claim(message('m4'), 9)
    expect(recoverStaleClaims(bus, { expiredBefore: 10 })).toBe(1)
    expect(bus.inboxRow('m4', 1)?.state).toBe('released')
  })

  it('leaves a CONSUMED row untouched when recovery sweeps, so a settled effect cannot be undone', () => {
    // Found by mutation: widening the sweep to every row regardless of state
    // passed the whole suite. A consumed row swept back to `released` would be
    // re-claimable, and the effect would run twice — the exact thing the inbox
    // exists to prevent.
    const bus = store()
    commitIntake(bus, { message: message('m4b'), claimedByTurn: 1, outbox: [] })
    bus.claim(message('m4c'), 1)
    expect(recoverStaleClaims(bus, { expiredBefore: 10 })).toBe(1)
    expect(bus.inboxRow('m4b', 1)?.state).toBe('consumed')
    expect(bus.inboxRow('m4c', 1)?.state).toBe('released')
  })

  it('lets a RELEASED message be claimed again, which is the restoration the previous rule forbade', () => {
    // BLOCKED-088 exactly: `goal-round-driver` restores a claimed message whose
    // reservation went stale. Treating `claimed` as terminal made that illegal.
    const bus = store()
    bus.claim(message('m5'), 9)
    recoverStaleClaims(bus, { expiredBefore: 10 })
    expect(() => { bus.claim(message('m5'), 11) }).not.toThrow()
    expect(bus.inboxRow('m5', 1)?.state).toBe('claimed')
    expect(bus.inboxRow('m5', 1)?.claimedByTurn).toBe(11)
  })

  it('refuses to re-claim a CONSUMED message, so the effect cannot run twice', () => {
    // The counterpart, without which "released is re-claimable" would just be
    // "everything is re-claimable" and the dedup would be gone.
    const bus = store()
    commitIntake(bus, { message: message('m6'), claimedByTurn: 7, outbox: [] })
    expect(() => { bus.claim(message('m6'), 11) }).toThrow(/consumed/u)
  })

  it('treats the same id at a different EPOCH as a different message', () => {
    const bus = store()
    commitIntake(bus, { message: message('m7', 1), claimedByTurn: 7, outbox: [] })
    expect(() => { bus.claim(message('m7', 2), 8) }).not.toThrow()
    expect(bus.inboxRow('m7', 2)?.state).toBe('claimed')
  })

  it('drops a second intake of the SAME id and epoch, so the epoch case is not just "everything is new"', () => {
    // The reverse of the case above. Without it, "a different epoch is a
    // different message" would be satisfied by a store that treats every
    // arrival as new, and the dedup would be gone.
    const bus = store()
    commitIntake(bus, { message: message('m7b', 1), claimedByTurn: 7, outbox: [] })
    expect(() => { bus.claim(message('m7b', 1), 8) }).toThrow(/consumed/u)
  })
})

describe('P4-06: the seen-set classifyIntake reads is the consumed rows', () => {
  it('reports exactly the consumed keys, so the pure classifier and the durable state agree', () => {
    const bus = store()
    commitIntake(bus, { message: message('m8'), claimedByTurn: 7, outbox: [] })
    bus.claim(message('m9'), 8)
    expect([...bus.consumedKeys()]).toEqual(['m8:1'])
  })
})
