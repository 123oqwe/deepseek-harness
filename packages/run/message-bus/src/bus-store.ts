/**
 * The message bus's own durable store: domain events, the outbox, and the
 * inbox claim, committed in one SQLite transaction (P4-06 must[0]).
 *
 * **Its own database, deliberately.** The reworded must[0] (C13) names one
 * `BEGIN IMMEDIATE` and excludes the storage KV seam, and neither existing
 * SQLite path fits: the KV seam is what the clause rules out, and
 * `session-query-sqlite` exists for session SEARCH with its schema version
 * owned by another package. Putting run-time message state under an owner that
 * did not choose it would make one package's migration another's problem.
 *
 * **The append-only run log is not part of the transaction.** P4-01's JSONL
 * append is the EFFECT of an outbox delivery — at-least-once, with the
 * consumer idempotent on `(messageId, epoch)` — while the durable write here
 * is the transaction that effect projects from. Folding the log into the
 * transaction would make a delivery's success a precondition of recording that
 * it was owed.
 *
 * **The inbox's three states exist for BLOCKED-088.** The rule that preceded
 * them treated `claimed` as terminal, which forbade `goal-round-driver`'s
 * deliberate restoration of a claimed message whose reservation had gone
 * stale — a turn that never ran and therefore produced no effect. Under
 * `claimed | consumed | released`, recovery sweeps an expired claim to
 * `released` and that restoration is an ordinary re-claim.
 *
 * Field names follow the CloudEvents attributes this epic owns
 * (`standards-ownership.json`): `id`, `source`, `type`, `time`, `subject`,
 * `datacontenttype`.
 *
 * @module @deepseek-ai/dsh-message-bus/bus-store
 */

/** One arriving message, in CloudEvents attribute names plus this bus's epoch. */
export interface BusMessage {
  readonly id: string
  readonly source: string
  readonly type: string
  readonly time: string
  readonly subject?: string
  readonly datacontenttype?: string
  /** The delivery epoch; the same id at a different epoch is a different message. */
  readonly epoch: number
  readonly data: unknown
}

/** What an inbox row records about one message's claim. */
export type InboxState =
  /** A turn has taken responsibility and has not committed yet. */
  | 'claimed'
  /** The business effect ran and committed with its outbox rows. */
  | 'consumed'
  /** A claim expired without committing; the message may be claimed again. */
  | 'released'

/** One inbox row. */
export interface InboxRow {
  readonly messageId: string
  readonly epoch: number
  readonly claimedByTurn: number
  readonly state: InboxState
}

/** One row the outbox owes a peer. */
export interface OutboxRow {
  readonly target: string
  readonly payload: unknown
}

/** The store's handle. */
export interface BusStore {
  /** Take responsibility for a message on behalf of one turn. */
  claim: (message: BusMessage, turn: number) => void
  /** The inbox row for one `(id, epoch)`, or undefined when none exists. */
  inboxRow: (messageId: string, epoch: number) => InboxRow | undefined
  /** Every committed domain event, in commit order. */
  domainEvents: () => readonly BusMessage[]
  /** Every outbox row awaiting delivery. */
  outboxRows: () => readonly OutboxRow[]
  /** The dedup keys of consumed messages, which is the seen-set `classifyIntake` reads. */
  consumedKeys: () => ReadonlySet<string>
}

/** What one intake commits, all inside a single transaction. */
export interface IntakeCommit {
  readonly message: BusMessage
  readonly claimedByTurn: number
  readonly outbox: readonly OutboxRow[]
  /** Test-only fault injection: abort after the domain event is written. */
  readonly failAfterDomainEvent?: boolean
}

/** How far back a claim must reach to count as expired. */
export interface RecoveryWindow {
  readonly expiredBefore: number
}

/**
 * Open (creating if absent) the bus store for one profile or run directory.
 * @param directory - the directory holding `bus.sqlite`.
 * @returns the store handle.
 */
export function openBusStore(directory: string): BusStore {
  throw new Error(`not implemented: openBusStore(${directory})`)
}

/**
 * Commit a domain event, its outbox rows and the inbox transition to
 * `consumed`, in one `BEGIN IMMEDIATE` transaction.
 * @param store - the store handle.
 * @param commit - the message, the claiming turn, and the rows it owes.
 */
export function commitIntake(store: BusStore, commit: IntakeCommit): void {
  void store
  throw new Error(`not implemented: commitIntake(${commit.message.id})`)
}

/**
 * Sweep claims older than the window to `released`, so a turn that never ran
 * does not hold a message forever.
 * @param store - the store handle.
 * @param window - the expiry boundary.
 * @returns how many rows were released.
 */
export function recoverStaleClaims(store: BusStore, window: RecoveryWindow): number {
  void store
  throw new Error(`not implemented: recoverStaleClaims(${String(window.expiredBefore)})`)
}
