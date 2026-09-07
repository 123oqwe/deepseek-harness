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

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { classifyDedup, dedupKey } from '@deepseek-ai/dsh-intake-dedup'
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

describe('P4-06 must[0]: BEGIN IMMEDIATE is what makes a contended commit WAIT rather than fail', () => {
  it('completes a commit that arrives while another process holds the write lock', async () => {
    // The one property a single-process suite cannot see. IMMEDIATE and
    // DEFERRED leave the same end state alone in a process — both roll back to
    // nothing — so replacing one with the other passed every other case here.
    // Under contention they differ, and the difference is the product
    // behaviour the clause names: measured, IMMEDIATE waits out the holder and
    // succeeds, while DEFERRED's read-to-write upgrade throws `database is
    // locked` immediately, because waiting at that point would deadlock.
    //
    // No test hook in production code: the competing writer is a real second
    // process against the same file, which is also the situation being modelled.
    const dir = mkdtempSync(join(tmpdir(), 'bus-contended-'))
    roots.push(dir)
    const bus = openBusStore(dir)

    const holder = spawn(process.execPath, ['-e', [
      "const { DatabaseSync } = require('node:sqlite')",
      `const db = new DatabaseSync(${JSON.stringify(join(dir, 'bus.sqlite'))})`,
      "db.exec('BEGIN IMMEDIATE')",
      "db.prepare(\"INSERT INTO inbox (message_id, epoch, claimed_by_turn, state) VALUES ('holder', 1, 1, 'claimed')\").run()",
      "console.log('HELD')",
      "setTimeout(() => { db.exec('COMMIT'); db.close() }, 400)",
    ].join('\n')], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await new Promise(resolve => holder.stdout.once('data', resolve))
      commitIntake(bus, { message: message('contended'), claimedByTurn: 3, outbox: [{ target: 'peer', payload: { n: 1 } }] })
      expect(bus.inboxRow('contended', 1)?.state).toBe('consumed')
      expect(bus.outboxRows()).toHaveLength(1)
    } finally {
      holder.kill()
    }
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

describe('P4-06 must[2]: the durable seen-set and the dedup rule agree (BLOCKED-138)', () => {
  // The superseded case asserted the literal `['m8:1']` under a title claiming
  // the classifier and the durable state agree. They did not: the store spelled
  // its key `${id}:${epoch}` while the rule spells it `${id.length}:${id}:${epoch}`,
  // so a consumed message classified as a first arrival — and the case was
  // green, and mutation-sensitive, the whole time. A title that claims
  // agreement has to assert the agreement itself, through the classifier,
  // rather than pin a value someone typed.

  it('classifies a message the store has CONSUMED as a duplicate, through the real seen-set', () => {
    const bus = store()
    commitIntake(bus, { message: message('m8'), claimedByTurn: 7, outbox: [] })
    expect(classifyDedup(message('m8'), bus.consumedKeys()).action).toBe('drop')
  })

  it('classifies a message the store has only CLAIMED as a first arrival, so the drop above is selective', () => {
    // The positive control. Without it, a seen-set that reported every message,
    // or a classifier that dropped everything, would satisfy the case above.
    const bus = store()
    bus.claim(message('m9'), 8)
    expect(classifyDedup(message('m9'), bus.consumedKeys()).action).toBe('accept')
  })

  it('keeps `(a:1, 2)` and `(a, 1:2)` distinct on BOTH sides, which the store\'s own spelling did not', () => {
    // The collision the length prefix exists to prevent. The store had dropped
    // the prefix, so these two messages shared one key and consuming either
    // would have suppressed the other.
    const bus = store()
    commitIntake(bus, { message: { ...message('a:1'), epoch: 2 }, claimedByTurn: 1, outbox: [] })
    expect(classifyDedup({ id: 'a:1', epoch: 2 }, bus.consumedKeys()).action).toBe('drop')
    expect(classifyDedup({ id: 'a', epoch: 12 }, bus.consumedKeys()).action).toBe('accept')
  })

  it('reports every consumed key as the rule computes it, with no second spelling anywhere', () => {
    const bus = store()
    commitIntake(bus, { message: message('m8'), claimedByTurn: 7, outbox: [] })
    bus.claim(message('m9'), 8)
    // The expectation comes from `dedupKey`, not from a typed literal: a
    // literal is what made the superseded case wrong.
    expect([...bus.consumedKeys()]).toEqual([dedupKey({ id: 'm8', epoch: 1 })])
  })
})
