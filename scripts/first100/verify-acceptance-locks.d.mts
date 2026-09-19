/**
 * Declarations for `verify-acceptance-locks.mjs` (BLOCKED-081).
 * @module scripts/first100/verify-acceptance-locks
 */

/** The epics the machine-readable mirror lists, or why it could not be read. */
export type MirrorLocks = { epics: string[] } | { unreadable: string }

/**
 * The epics the machine-readable `ACCEPT-BLOCKED` block lists as locked.
 *
 * Fail-closed by construction: an absent, duplicated, inverted or empty block
 * returns `unreadable`, and the caller treats that as LOCKED.
 * @param queue - the text of `BLOCKED-QUEUE.md`.
 * @returns the listed epics, or the reason the block could not be read.
 */
export function mirrorLockedEpics(queue: string): MirrorLocks

/** One OPEN status line that states a lock in prose, and the epic it names. */
export interface StatusLineLockClaim {
  id: string
  epic: string
  phrase: string
  line: string
}

/**
 * Epic ids named on the status line of an OPEN entry that asserts a lock.
 *
 * A reading for a person, never a verdict: prose names its subject in ways no
 * matcher recovers, so the caller prints these and decides nothing by them.
 * @param queue - the text of `BLOCKED-QUEUE.md`.
 * @returns one row per (entry, epic) pair, in file order.
 */
export function statusLineLockClaims(queue: string): StatusLineLockClaim[]

/**
 * Epics the ledger records as ACCEPTED.
 * @param ledger - the ledger document.
 * @returns the accepted epic ids.
 */
export function acceptedEpics(ledger: unknown): Set<string>
