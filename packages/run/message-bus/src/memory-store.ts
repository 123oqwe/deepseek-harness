/**
 * An in-memory bus, for a caller that is genuinely alone (Epic P4-06).
 *
 * The counterpart to `openBusStore`, and the same split `@deepseek-ai/dsh-lease`
 * makes against `@deepseek-ai/dsh-lease-sqlite`: a single-process composition,
 * and every suite whose subject is a consumer's behaviour rather than what
 * survives a restart. It is NOT a substitute for the durable store in a
 * deployment — everything here dies with the process, so two hosts each hold
 * their own bus and neither can hand the other a message, which is the failure
 * the durable store exists to prevent.
 *
 * It exists because §12.40 made the bus a hard dependency of every subagent
 * composition: a settlement must be committed before delivery, so the manager
 * has to be able to reach a bus. Requiring a SQLite file for that would put a
 * temporary directory into thirty-eight unit suites whose subject is not
 * durability.
 *
 * @module @deepseek-ai/dsh-message-bus/memory-store
 */

import { dedupKey } from '@deepseek-ai/dsh-intake-dedup'
import type { BusMessage, BusStore, InboxRow, IntakeCommit, RecoveryWindow, StoredOutboxRow } from './bus-store.ts'
import type { OutboxRecord } from './outbox.ts'

/** The rows one in-memory bus holds. */
interface MemoryState {
  readonly domainEvents: BusMessage[]
  readonly outbox: { record: OutboxRecord; target: string; payload: unknown }[]
  readonly inbox: Map<string, InboxRow>
}

/** Each store's rows, module-private so a holder cannot reach past the contract. */
const STATES = new WeakMap<BusStore, MemoryState>()

/**
 * The inbox key for one message, delegated to the shared rule.
 *
 * Derived through `dedupKey` rather than spelled out here, for the reason
 * BLOCKED-138 records against the durable store: a second derivation answered
 * in a format `classifyDedup` never produces, so a consumed message classified
 * as a first arrival with every test on both sides still green.
 * @param source - the emitter the id is scoped to.
 * @param messageId - the message id.
 * @param epoch - the sender generation.
 * @returns the key.
 */
const keyOf = (source: string, messageId: string, epoch: number): string => dedupKey({ source, id: messageId, epoch })

/**
 * The state behind one in-memory store handle.
 * @param store - the handle.
 * @returns its rows.
 * @throws when the handle did not come from {@link openMemoryBusStore}.
 */
function stateOf(store: BusStore): MemoryState {
  const state = STATES.get(store)
  if (state === undefined) throw new Error('memory bus store: this handle was not produced by openMemoryBusStore')
  return state
}

/**
 * Open an in-memory bus.
 *
 * Atomic within ONE process, which is all it promises: every method is
 * synchronous, so a read, a decision and a write have no suspension point
 * between them. Across processes it promises nothing.
 * @returns a store honouring the bus contract, holding its rows in memory.
 */
export function openMemoryBusStore(): BusStore {
  const state: MemoryState = { domainEvents: [], outbox: [], inbox: new Map() }
  const store: BusStore = {
    claim(message: BusMessage, turn: number): void {
      const key = keyOf(message.source, message.id, message.epoch)
      const existing = state.inbox.get(key)
      // A consumed row is settled: re-claiming it would let one message be run
      // twice, which is the whole thing the inbox refuses.
      if (existing?.state === 'consumed') return
      state.inbox.set(key, {
        source: message.source,
        messageId: message.id,
        epoch: message.epoch,
        claimedByTurn: turn,
        state: 'claimed',
      })
    },
    inboxRow: (source, messageId, epoch) => state.inbox.get(keyOf(source, messageId, epoch)),
    domainEvents: () => [...state.domainEvents],
    outboxRows: () => state.outbox.map(row => ({ ...row })),
    persistOutbox(record: OutboxRecord): void {
      const index = state.outbox.findIndex(row => row.record.id === record.id && row.record.epoch === record.epoch)
      const found = state.outbox[index]
      /* v8 ignore next -- a caller can only hold a record this store handed out. */
      if (found === undefined) return
      state.outbox[index] = { ...found, record }
    },
    consumedKeys: () => new Set([...state.inbox.entries()]
      .filter(([, row]) => row.state === 'consumed')
      .map(([key]) => key)),
  }
  STATES.set(store, state)
  return store
}

/**
 * Commit a domain event, its outbox rows and the inbox transition together.
 *
 * "Together" is the whole promise, and here it is free: the writes are
 * synchronous with no `await` between them, so nothing can observe a partial
 * commit. The durable store buys the same property with `BEGIN IMMEDIATE`.
 * @param store - the in-memory store.
 * @param commit - the message, the claiming turn, and the rows it owes.
 */
export function commitMemoryIntake(store: BusStore, commit: IntakeCommit): void {
  const state = stateOf(store)
  const { message } = commit
  store.claim(message, commit.claimedByTurn)
  state.domainEvents.push(message)
  for (const row of commit.outbox) {
    state.outbox.push({
      record: {
        id: message.id as OutboxRecord['id'],
        epoch: message.epoch as OutboxRecord['epoch'],
        tenant: row.tenant,
        state: 'pending',
        priority: row.priority,
        deadlineMs: row.deadlineMs,
        attempts: 0,
        receipt: null,
      },
      target: row.target,
      payload: row.payload,
    })
  }
  const key = keyOf(message.source, message.id, message.epoch)
  const claimed = state.inbox.get(key)
  /* v8 ignore next -- `claim` above always leaves a row unless it was consumed. */
  if (claimed !== undefined) state.inbox.set(key, { ...claimed, state: 'consumed' })
}

/**
 * Sweep claims older than the window back to `released`.
 * @param store - the in-memory store.
 * @param window - the expiry boundary.
 * @returns how many rows were released.
 */
export function recoverMemoryStaleClaims(store: BusStore, window: RecoveryWindow): number {
  const state = stateOf(store)
  let released = 0
  for (const [key, row] of state.inbox) {
    // Only `claimed` rows are swept: a `consumed` row is settled and a
    // `released` one is already available.
    if (row.state !== 'claimed' || row.claimedByTurn >= window.expiredBefore) continue
    state.inbox.set(key, { ...row, state: 'released' })
    released++
  }
  return released
}

export type { StoredOutboxRow }
