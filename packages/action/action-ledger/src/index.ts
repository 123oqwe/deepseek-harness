/**
 * The idempotency ledger's decisions (Epic P4-12, C stage).
 *
 * Pure functions over a caller-supplied entry: nothing here reads a store or
 * sends anything. The store is the Provider stage, and the wiring into the
 * tool path is Usage; keeping the decisions separable is what lets the crash
 * campaign drive them directly.
 *
 * @module @deepseek-ai/dsh-action-ledger
 */

export { default } from './plugin.ts'
export type { Config as ActionLedgerConfig } from './plugin.ts'
export type {
  LedgerEntry,
  LedgerEpoch,
  LedgerGeneration,
  LedgerScope,
  LedgerState,
  ProviderIdempotency,
  ReceiptDigest,
  ReserveDecision,
  ReserveRequest,
} from './types.ts'

import type { LedgerEntry, ProviderIdempotency, ReserveDecision, ReserveRequest } from './types.ts'

/**
 * Decide whether a caller may send one external effect.
 *
 * Check order is load-bearing and is not the order the clauses are written in.
 * The ARGUMENTS check runs before the state check: the same key with different
 * arguments is a caller defect whatever the entry's state, and answering
 * `duplicate` there would tell the caller its second, different request had
 * already been carried out. The EPOCH check runs before the outcome checks for
 * the mirror reason — a fenced-out generation must not learn the outcome of
 * work it no longer owns, and must not be told to reconcile it.
 *
 * **Every generation comparison needs a generation on BOTH sides.** A request
 * or an entry may be `'unfenced'`, and an unfenced caller is not an early
 * generation of anything: it is outside the ordering. Comparing it as a number
 * is what made epoch `0` stand in for "no lease" and made must[2] vacuous for
 * every lease-less caller (BLOCKED-221).
 * @param request - the key, arguments and generation the caller presents.
 * @param existing - the ledger's current entry for this key, absent on first use.
 * @returns the decision; only `reserved` authorizes sending.
 */
export function decideReservation(request: ReserveRequest, existing: LedgerEntry | undefined): ReserveDecision {
  if (existing === undefined) {
    return { action: 'reserved', fenced: request.epoch !== 'unfenced', entry: { scope: request.scope, key: request.key, argumentsHash: request.argumentsHash, state: 'prepared', epoch: request.epoch } }
  }
  if (existing.argumentsHash !== request.argumentsHash) {
    return { action: 'refused', reason: 'arguments-differ', firstArgumentsHash: existing.argumentsHash }
  }
  // Both generations present, or there is no ordering to judge staleness by.
  const comparable = request.epoch !== 'unfenced' && existing.epoch !== 'unfenced'
  if (comparable && request.epoch < existing.epoch) {
    return { action: 'refused', reason: 'stale-epoch', currentEpoch: existing.epoch }
  }
  if (existing.state === 'ambiguous') return { action: 'refused', reason: 'ambiguous-needs-reconciliation' }
  if (existing.state === 'prepared') {
    // A `prepared` entry is held and UNSENT, so who may take it over is a
    // question about the holder, not about the effect. A HIGHER generation may:
    // the fence proves the previous holder is out (must[3]). The SAME
    // generation may not — the holder is a live peer, and two holders of one
    // reservation is the state must[2] forbids.
    //
    // This returned `reserved` for every epoch >= existing until BLOCKED-221.
    // The two-process case passed anyway because the winner reached `markSent`
    // before the loser's transaction began: `reserve`'s transaction spans the
    // read and the write, and the send is a separate step after it. Under load
    // the winner lost that second, uncovered race and both processes held the
    // same reservation — so the case was reporting the schedule, not must[2].
    if (comparable && request.epoch === existing.epoch) {
      return { action: 'refused', reason: 'held-at-same-epoch', heldEpoch: existing.epoch }
    }
    // Either side unfenced: re-take, because refusing would strand the key —
    // without generations nothing can prove the holder gone — and at-least-once
    // is the guarantee that survives here. `fenced: false` records that must[2]
    // does not cover this reservation, including when a well-fenced caller
    // takes over an entry whose unfenced holder can still send.
    return {
      action: 'reserved',
      fenced: comparable,
      // The entry carries the NEW holder's generation, `'unfenced'` included:
      // `markSent` and the other transitions match on it, so an entry left at
      // the previous holder's generation would refuse every write by the caller
      // just told it holds the reservation.
      entry: { ...existing, epoch: request.epoch },
    }
  }
  return { action: 'duplicate', state: existing.state }
}

/**
 * The request header a provider with native support expects.
 *
 * Named here rather than at each call site so the header spelling has one
 * home: `draft-ietf-httpapi-idempotency-key-header-07` defines it as
 * `Idempotency-Key`, and a provider adapter that spells it differently is not
 * passing the key through.
 * @param provider - how this provider takes the key.
 * @param key - the manifest's idempotency key.
 * @returns the header pair to send, or undefined when the provider has no native support.
 */
export function idempotencyHeader(provider: ProviderIdempotency, key: string): { name: string; value: string } | undefined {
  return provider.kind === 'native' ? { name: provider.headerName, value: key } : undefined
}
