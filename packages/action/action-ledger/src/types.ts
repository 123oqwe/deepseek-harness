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

/**
 * The fencing generation of the worker holding a reservation.
 *
 * A reservation is only safe while the holder is the current generation: a
 * process that stalls, loses its lease and comes back must not complete a
 * reservation the next generation has already taken over. The ledger refuses
 * the stale one (must[3]).
 */
export type LedgerEpoch = BrandedNumber<'LedgerEpoch'>

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

/** One ledger row: an external effect and what is known about it. */
export interface LedgerEntry {
  readonly key: IdempotencyKey
  /** The arguments this key was first reserved with; a later mismatch is refused (acceptance[2]). */
  readonly argumentsHash: ArgumentsHash
  readonly state: LedgerState
  /** The generation that holds the reservation. */
  readonly epoch: LedgerEpoch
  /** Present once a receipt has been seen; absent in every other state. */
  readonly receiptDigest?: ReceiptDigest
}

/** A caller asking to take responsibility for one external effect. */
export interface ReserveRequest {
  readonly key: IdempotencyKey
  readonly argumentsHash: ArgumentsHash
  readonly epoch: LedgerEpoch
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
  /** The caller holds the reservation and may send. */
  | { readonly action: 'reserved'; readonly entry: LedgerEntry }
  /** Someone already sent or confirmed this effect; do not send again. */
  | { readonly action: 'duplicate'; readonly state: LedgerState }
  /** The same key was first reserved with different arguments (acceptance[2]). */
  | { readonly action: 'refused'; readonly reason: 'arguments-differ'; readonly firstArgumentsHash: ArgumentsHash }
  /** A newer generation holds this key; this caller has been fenced out (must[3]). */
  | { readonly action: 'refused'; readonly reason: 'stale-epoch'; readonly currentEpoch: LedgerEpoch }
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
