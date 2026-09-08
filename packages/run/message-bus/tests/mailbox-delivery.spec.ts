/**
 * P4-06 must[2] at its production call site: a real mailbox arrival decided
 * against the durable consumed set.
 *
 * BLOCKED-136 recorded why this file exists. `classifyIntake` had no
 * production caller, so "the classifier decides correctly" was provable while
 * "a real arrival was deduplicated" was not, and the rule itself had two
 * implementations — this package's and the retired `dsh-mailbox`'s, the second citing the
 * first in a comment instead of importing it.
 *
 * The join lives here because the store is
 * orchestration-runtime and the mailbox is a capability definition: a mailbox
 * reaching for the store would be a definition depending on a runtime.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MailboxMessageId as MessageId, ParticipantId, SenderEpoch } from '../src/index.ts'
import { commitIntake, openBusStore } from '../src/bus-store.ts'
import type { BusStore } from '../src/bus-store.ts'
import { decideMailboxDelivery } from '../src/mailbox-delivery.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function store(): BusStore {
  const dir = mkdtempSync(join(tmpdir(), 'mailbox-delivery-'))
  roots.push(dir)
  return openBusStore(dir)
}

const RECIPIENT = brandString<ParticipantId>('worker-1')

const SENDER = brandString<ParticipantId>('sender-1')

const arriving = (id: string, epoch = 1, to: ParticipantId = RECIPIENT) => ({
  id: brandString<MessageId>(id),
  epoch: epoch as SenderEpoch,
  from: SENDER,
  to,
  body: { n: 1 },
})

/** The same message as the bus sees it, so one arrival can be committed first. */
const busMessage = (id: string, epoch = 1) => ({
  id,
  // The bus records the SAME emitter the mailbox message carries in `from`:
  // the dedup key is `(source, id, epoch)`, so a commit under a different
  // source would key a different message and the redelivery would not match
  // (BLOCKED-140).
  source: SENDER,
  type: 'dsh.mailbox.message',
  time: '2026-09-07T00:00:00.000Z',
  subject: 'subject-1',
  datacontenttype: 'application/json',
  epoch,
  data: { n: 1 },
})

describe('P4-06 must[2]: a real mailbox arrival is deduplicated against the durable consumed set', () => {
  it('delivers a message this bus has never consumed', () => {
    const bus = store()
    expect(decideMailboxDelivery(bus, arriving('mb-1'), RECIPIENT).action).toBe('deliver')
  })

  it('drops a REDELIVERY of a message this bus already consumed, which is the effect must[2] names', () => {
    // The case BLOCKED-136 said could not be written: an arrival on the real
    // mailbox path, decided against state a committed intake really wrote,
    // rather than against a set the test assembled for itself.
    const bus = store()
    commitIntake(bus, { message: busMessage('mb-2'), claimedByTurn: 1, outbox: [] })
    const decision = decideMailboxDelivery(bus, arriving('mb-2'), RECIPIENT)
    expect(decision.action).toBe('drop')
    expect(decision).toMatchObject({ reason: 'duplicate' })
  })

  it('treats the same id at a LATER epoch as a new message, so a restarted sender is not silenced', () => {
    const bus = store()
    commitIntake(bus, { message: busMessage('mb-3', 1), claimedByTurn: 1, outbox: [] })
    expect(decideMailboxDelivery(bus, arriving('mb-3', 2), RECIPIENT).action).toBe('deliver')
  })

  it('refuses a message addressed elsewhere BEFORE consulting the seen-set', () => {
    // The mailbox's own precedence check, still its own. A misdirected message
    // must not be recorded as seen here, or it would suppress a later
    // legitimate message sharing its key.
    const bus = store()
    const decision = decideMailboxDelivery(bus, arriving('mb-4', 1, brandString<ParticipantId>('worker-2')), RECIPIENT)
    expect(decision).toEqual({ action: 'refuse', reason: 'not-addressed-to-recipient' })
  })

  it('reads the seen-set at DECISION time, so a message consumed after the handle was taken still drops', () => {
    // The reason the store is passed rather than a set: a caller that snapshots
    // `consumedKeys()` once holds a set that is empty after a restart and stale
    // after any other consumer commits.
    const bus = store()
    const before = decideMailboxDelivery(bus, arriving('mb-5'), RECIPIENT)
    commitIntake(bus, { message: busMessage('mb-5'), claimedByTurn: 1, outbox: [] })
    const after = decideMailboxDelivery(bus, arriving('mb-5'), RECIPIENT)
    expect([before.action, after.action]).toEqual(['deliver', 'drop'])
  })

  it('still drops the redelivery after a RESTART, because the seen-set is the durable rows', () => {
    // What a caller-supplied set could never give: the process that consumed
    // the message is gone, and the arrival is still recognised.
    const dir = mkdtempSync(join(tmpdir(), 'mailbox-delivery-restart-'))
    roots.push(dir)
    commitIntake(openBusStore(dir), { message: busMessage('mb-6'), claimedByTurn: 1, outbox: [] })
    expect(decideMailboxDelivery(openBusStore(dir), arriving('mb-6'), RECIPIENT).action).toBe('drop')
  })
})
