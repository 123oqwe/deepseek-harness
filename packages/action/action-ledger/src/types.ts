/**
 * The external-effect idempotency ledger's vocabulary (Epic P4-12, C stage).
 *
 * A tool result proves what the harness recorded; it cannot prove what the
 * outside world committed. A crash between sending a request and persisting
 * its result leaves a state nobody can read off the log: the email may or may
 * not have gone out. This ledger is the record that makes the difference
 * decidable, so a retry after that crash does not send it twice.
 *
 * Types only, per the repository rule for `src/types.ts`.
 *
 * @module @deepseek-ai/dsh-action-ledger/types
 */

import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'

/**
 * The fencing generation of the worker holding a reservation.
 *
 * A reservation is only safe while the holder is the current generation: a
 * process that stalls, loses its lease and comes back must not complete a
 * reservation the next generation has already taken over. The ledger refuses
 * the stale one (must[3]).
 */
export type LedgerEpoch = BrandedNumber<'LedgerEpoch'>

/**
 * A caller's generation, or the absence of one.
 *
 * **`'unfenced'` is a state, not the number zero** (BLOCKED-221). A lease-less
 * caller used to arrive as epoch `0` from a `?? 0` at the call site, which made
 * every lease-less caller indistinguishable from every other — so the ledger
 * could not tell a concurrent peer from one worker restarting, and must[2]'s
 * two-holder refusal silently did not apply to any of them. Naming the absence
 * is what lets a decision say which rule admitted it and lets an audit read
 * that back.
 *
 * Fencing is what makes exclusion decidable; without a generation the ledger
 * keeps at-least-once and gives up exclusivity, and says so rather than
 * pretending to a guarantee it cannot hold.
 */
export type LedgerGeneration = LedgerEpoch | 'unfenced'

/** A digest of the provider's own receipt, which is the evidence an effect committed. */
export type ReceiptDigest = Branded<'ReceiptDigest'>

/**
 * What the ledger knows about one external effect.
 *
 * The five states are not a status label; they are what a recovering process
 * is allowed to do next:
 */
export type LedgerState =
  /** Reserved and not yet sent: the request has not left the harness, so a retry may send it. */
  | 'prepared'
  /** The request left the harness and no receipt came back yet: a retry MUST NOT send it again. */
  | 'sent'
  /** A receipt proves the effect committed: further attempts are duplicates. */
  | 'confirmed'
  /** The outcome is unknown and cannot be made known by retrying: it goes to reconciliation (acceptance[1]). */
  | 'ambiguous'
  /** The effect happened and was undone by its compensation, so the key is settled, not free. */
  | 'compensated'

/**
 * Who a key belongs to.
 *
 * An idempotency key is unique PER CLIENT, not globally:
 * `draft-ietf-httpapi-idempotency-key-header-07` says so and gives the reason
 * in its security considerations — a server that does not scope keys by client
 * lets one client discover another's key state. Stripe scopes per account for
 * the same reason. Two agents that pick the same key (easy, when a key is
 * derived from an arguments hash or a counter) must get two reservations, and
 * neither may learn the other exists.
 *
 * The scope is the manifest's `actor`, so the ledger's answer to "whose key is
 * this" is the same as the rest of the harness's.
 */
export type LedgerScope = PrincipalId

/** One ledger row: an external effect and what is known about it. */
export interface LedgerEntry {
  /** The principal this key belongs to; keys are unique within a scope, never across. */
  readonly scope: LedgerScope
  readonly key: IdempotencyKey
  /** The arguments this key was first reserved with; a later mismatch is refused (acceptance[2]). */
  readonly argumentsHash: ArgumentsHash
  readonly state: LedgerState
  /** The generation that holds the reservation, or `'unfenced'` when its holder had none. */
  readonly epoch: LedgerGeneration
  /** Present once a receipt has been seen; absent in every other state. */
  readonly receiptDigest?: ReceiptDigest
}

/** A caller asking to take responsibility for one external effect. */
export interface ReserveRequest {
  readonly scope: LedgerScope
  readonly key: IdempotencyKey
  readonly argumentsHash: ArgumentsHash
  /** The caller's generation, or `'unfenced'` when no lease issued it one. */
  readonly epoch: LedgerGeneration
}

/**
 * Whether the caller may proceed, and if not, why.
 *
 * `reserved` is the ONLY decision that authorizes sending. Every refusal names
 * a different situation because they demand different handling: a duplicate is
 * satisfied by the first attempt's outcome, a parameter mismatch is a caller
 * defect, a stale epoch means another generation owns the work, and an
 * ambiguous entry needs a human or a reconciler rather than another attempt.
 */
export type ReserveDecision =
  /**
   * The caller holds the reservation and may send.
   *
   * `fenced` records WHICH rule admitted it, because the two rules promise
   * different things. A fenced reservation is backed by a lease generation on
   * both sides, so must[2] — two workers cannot both hold one reservation —
   * applies to it. An unfenced one was admitted under the degraded rule: a
   * `prepared` entry is re-taken so at-least-once survives, and must[2] is NOT
   * promised, because without generations the ledger cannot tell a live peer
   * from the same worker restarting. Taking over an entry whose own holder was
   * unfenced is equally unfenced, however well fenced the new caller is: the
   * old holder can still send.
   *
   * Carried on the decision rather than re-derived by the caller so the
   * distinction reaches the audit record, where the difference between a
   * guaranteed and a degraded reservation is the fact worth having.
   */
  | { readonly action: 'reserved'; readonly entry: LedgerEntry; readonly fenced: boolean }
  /** Someone already sent or confirmed this effect; do not send again. */
  | { readonly action: 'duplicate'; readonly state: LedgerState }
  /** The same key was first reserved with different arguments (acceptance[2]). */
  | { readonly action: 'refused'; readonly reason: 'arguments-differ'; readonly firstArgumentsHash: ArgumentsHash }
  /** A newer generation holds this key; this caller has been fenced out (must[3]). */
  | { readonly action: 'refused'; readonly reason: 'stale-epoch'; readonly currentEpoch: LedgerEpoch }
  /**
   * A peer at this SAME lease generation holds the reservation and has not sent
   * (must[2], BLOCKED-221).
   *
   * Distinct from `duplicate`, which asserts the effect already happened, and
   * from `stale-epoch`, which asserts a NEWER generation fenced this caller
   * out. Here neither is true: the holder is a peer, not a successor, and
   * nothing was sent. Reported only for a fenced request — an unfenced caller
   * cannot be told it has a peer, because without a generation the ledger
   * cannot tell a peer from this same worker restarting.
   */
  | { readonly action: 'refused'; readonly reason: 'held-at-same-epoch'; readonly heldEpoch: LedgerEpoch }
  /** The outcome is unknown; retrying cannot resolve it (acceptance[1]). */
  | { readonly action: 'refused'; readonly reason: 'ambiguous-needs-reconciliation' }

/**
 * How a provider takes an idempotency key.
 *
 * `native` passes the key through to the provider, which is
 * `draft-ietf-httpapi-idempotency-key-header-07`'s `Idempotency-Key` request
 * header: the provider itself collapses retries, and the ledger's job is
 * reduced to recording what it was told. `local-fencing` is for providers with
 * no such support, where the ledger's reservation IS the deduplication and the
 * caller must query target state to resolve an ambiguity.
 */
export type ProviderIdempotency =
  | { readonly kind: 'native'; readonly headerName: 'Idempotency-Key' }
  | { readonly kind: 'local-fencing' }
