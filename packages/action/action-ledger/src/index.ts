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

export type {
  LedgerEntry,
  LedgerEpoch,
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
 * @param request - the key, arguments and generation the caller presents.
 * @param existing - the ledger's current entry for this key, absent on first use.
 * @returns the decision; only `reserved` authorizes sending.
 */
export function decideReservation(request: ReserveRequest, existing: LedgerEntry | undefined): ReserveDecision {
  if (existing === undefined) {
    return { action: 'reserved', entry: { key: request.key, argumentsHash: request.argumentsHash, state: 'prepared', epoch: request.epoch } }
  }
  if (existing.argumentsHash !== request.argumentsHash) {
    return { action: 'refused', reason: 'arguments-differ', firstArgumentsHash: existing.argumentsHash }
  }
  if (request.epoch < existing.epoch) {
    return { action: 'refused', reason: 'stale-epoch', currentEpoch: existing.epoch }
  }
  if (existing.state === 'ambiguous') return { action: 'refused', reason: 'ambiguous-needs-reconciliation' }
  if (existing.state === 'prepared') {
    return { action: 'reserved', entry: { ...existing, epoch: request.epoch } }
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
