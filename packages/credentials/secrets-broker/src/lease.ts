/**
 * The lease state machine: issue, redeem, expire, revoke (P3-06 must[0]/must[2]).
 *
 * Pure decisions over values. Nothing here reads a clock, a store or a world —
 * the caller supplies `now` and the record, so every rule is observable without
 * a running system, and a test cannot pass by controlling something the product
 * would not control.
 * @module @deepseek-ai/dsh-secrets-broker/lease
 */

import type { ActionId } from '@deepseek-ai/dsh-action-manifest'
import type { WorldId } from '@deepseek-ai/dsh-execution-world'
import type { Principal } from '@deepseek-ai/dsh-principal'
import type {
  SecretLease,
  SecretLeaseDecision,
  SecretLeaseRecord,
  SecretLeaseState,
  SecretLeaseTerminalState,
} from './types.ts'

/**
 * The states each state may move to.
 *
 * `issued` is the only source of a transition: the three terminal states differ
 * in their reason and agree in being final, so a revoked lease cannot later
 * read as expired and an audit's answer to *why did this stop working* does not
 * change after the fact.
 */
const LEASE_STATE_SUCCESSORS: Readonly<Record<SecretLeaseState, readonly SecretLeaseState[]>> = {
  issued: ['redeemed', 'expired', 'revoked'],
  redeemed: [],
  expired: [],
  revoked: [],
}

/**
 * Whether one lease state may move to another.
 * @param from - the state the record is in.
 * @param to - the state being proposed.
 * @returns true when the move is legal.
 */
export function isLegalLeaseTransition(from: SecretLeaseState, to: SecretLeaseState): boolean {
  return LEASE_STATE_SUCCESSORS[from].includes(to)
}

/**
 * Whether a lease has outlived `expiresAt`.
 *
 * The comparison is `>=`, so a lease is unusable *at* its expiry instant rather
 * than one millisecond after it. A lease usable at exactly `expiresAt` would
 * make the recorded time mean "the last moment it works" in one place and "the
 * first moment it does not" in another.
 * @param lease - the lease to judge.
 * @param now - epoch milliseconds supplied by the caller.
 * @returns true when the lease is expired at `now`.
 */
export function isExpired(lease: SecretLease, now: number): boolean {
  return now >= lease.expiresAt
}

/**
 * The state a record holds once `now` is taken into account.
 *
 * Expiry is a fact about the clock, not an event someone has to remember to
 * record: a lease whose `expiresAt` has passed reads `expired` even if nothing
 * ever swept it. Without this, acceptance[2] would hold only where a sweeper
 * ran, and a replay against a store nobody swept would succeed.
 * @param record - the stored record.
 * @param now - epoch milliseconds supplied by the caller.
 * @returns the effective state.
 */
export function effectiveState(record: SecretLeaseRecord, now: number): SecretLeaseState {
  if (record.state !== 'issued') return record.state
  return isExpired(record.lease, now) ? 'expired' : 'issued'
}

/** What a redemption is presented with, beside the lease itself. */
export interface SecretLeasePresentation {
  readonly principal: Principal
  readonly action: ActionId
  readonly world: WorldId
}

/**
 * Decide whether a lease may be redeemed now (must[0], must[2], acceptance[2]).
 *
 * Expiry is tested FIRST, before the bindings and before the stored state. An
 * expired lease must refuse for being expired whoever presents it — testing a
 * binding first would let a caller learn, from the refusal reason alone, that
 * their principal or action *would* have matched, which is a fact about the
 * grant they no longer hold.
 * @param record - the stored record.
 * @param presented - the principal, action and world offering the lease.
 * @param now - epoch milliseconds supplied by the caller.
 * @returns the credential when redeemable, else the single reason it is not.
 */
export function decideRedemption(
  record: SecretLeaseRecord,
  presented: SecretLeasePresentation,
  now: number,
): SecretLeaseDecision {
  const state = effectiveState(record, now)
  if (state === 'expired') return { ok: false, refusal: 'expired' }
  if (state === 'redeemed') return { ok: false, refusal: 'already-redeemed' }
  if (state === 'revoked') return { ok: false, refusal: 'revoked' }
  const { lease } = record
  if (presented.principal.id !== lease.principal.id) return { ok: false, refusal: 'principal-mismatch' }
  if (presented.action !== lease.action) return { ok: false, refusal: 'action-mismatch' }
  if (presented.world !== lease.world) return { ok: false, refusal: 'world-mismatch' }
  return { ok: true, credential: lease.credential }
}

/**
 * The record that follows a successful redemption (must[2]).
 *
 * Use revokes: the returned record is `redeemed`, so the same lease presented
 * again refuses. A broker that left it `issued` would hold a credential
 * grant open for its whole expiry window after the one use it was issued for.
 * @param record - the record that was redeemed.
 * @returns the record in its `redeemed` state.
 */
export function afterRedemption(record: SecretLeaseRecord): SecretLeaseRecord {
  return { lease: record.lease, state: 'redeemed' }
}

/**
 * Withdraw a lease, recording why.
 *
 * A record already in a terminal state is returned unchanged: the first reason
 * a lease stopped being usable is the true one, and letting a later revocation
 * overwrite `expired` would rewrite an audit's answer.
 * @param record - the record to withdraw.
 * @param reason - the terminal state to move to.
 * @returns the withdrawn record, or the original when it was already terminal.
 */
export function revoke(record: SecretLeaseRecord, reason: SecretLeaseTerminalState): SecretLeaseRecord {
  if (record.state !== 'issued') return record
  return { lease: record.lease, state: reason }
}

/**
 * Revoke every lease bound to a world that has stopped.
 *
 * A lease names the world its action runs in, so a stopped world is the end of
 * every grant inside it whatever each lease's own expiry says. The cascade is a
 * pure function of the records and the world id, so it can be observed without
 * starting or stopping anything.
 * @param records - every lease the broker holds.
 * @param world - the world that stopped.
 * @returns the records, with those bound to `world` revoked.
 */
export function revokeWorldLeases(
  records: readonly SecretLeaseRecord[],
  world: WorldId,
): SecretLeaseRecord[] {
  return records.map(record => (record.lease.world === world ? revoke(record, 'revoked') : record))
}
