/**
 * The failure taxonomy and its retryability (Epic P4-11 must[0], must[2]'s
 * hedge rule, must[3], acceptance[0]).
 *
 * Pure and total: no I/O, no clock, no randomness.
 *
 * **This module decides WHETHER, never HOW LONG.** `@deepseek-ai/dsh-llm-retry`
 * already computes exponential backoff with jitter, and its jitter is
 * symmetric — it may raise a delay as well as lower it before clamping.
 * Symmetric jitter is legitimate jitter, so P4-11 unifies that implementation
 * rather than adding a second spelling beside it (§12.64). Likewise
 * `Retry-After` is already parsed at the provider boundary and carried on
 * `LlmError.providerRetryAfterMs`; this module never sees a header.
 *
 * The registry's problem statement is that several layers each decided
 * retryability for themselves and their limits multiplied. The fix is that
 * there is one of this function, not that it does more.
 *
 * @module @deepseek-ai/dsh-retry/classify
 */
import type { LedgerState } from '@deepseek-ai/dsh-action-ledger'

/**
 * Why a failure may not be retried.
 *
 * Each member names a DIFFERENT next move for an operator, which is why they
 * are not collapsed into one `permanent`: an invalid request needs its
 * arguments fixed, a policy denial needs an authorization decision, and an
 * unsettled external effect needs the ledger reconciled before anything is
 * sent again.
 */
export type PermanentReason =
  | 'client-error'
  | 'policy-denied'
  | 'invalid-input'
  | 'effect-unsettled'

/** What one layer observed, in terms this module can decide on. */
export interface FailureFacts {
  /** Transport or provider status, when the failure carried one. */
  readonly status?: number
  /** True when the attempt may have committed an external effect. */
  readonly sideEffecting?: boolean
  /**
   * The action ledger's state for that effect (P4-12), when one was reserved.
   *
   * Read rather than re-decided: P4-12 owns idempotency, and this module owns
   * only what its verdict means for retrying. Absent means no ledger was
   * consulted, which for a side-effecting attempt is NOT the same as safe.
   */
  readonly ledger?: LedgerState
  /** A typed refusal from the policy layer (P2-04's gate). */
  readonly denied?: boolean
  /** The request was rejected as malformed before it was attempted. */
  readonly malformed?: boolean
  /**
   * True when this attempt is a HEDGE of another in-flight attempt rather than
   * a retry of a finished one (must[2]'s hedge exclusion).
   *
   * Producing this flag belongs to P5-04, which owns hedging; BLOCKED-166
   * records that a hedged attempt must be tagged or this rule can never fire.
   */
  readonly hedged?: boolean
}

/** Whether the failure may be attempted again, and why not when it may not. */
export type RetryVerdict =
  | { readonly retryable: true }
  | { readonly retryable: false; readonly reason: PermanentReason }

/**
 * Statuses that are retryable despite being 4xx.
 *
 * `408` is the server saying it stopped waiting and `429` is it asking for
 * later; both name a next attempt. Every other 4xx says the REQUEST is wrong,
 * and repeating it unchanged asks the same question again.
 */
const RETRYABLE_CLIENT_STATUSES: readonly number[] = Object.freeze([408, 429])

/**
 * Ledger states under which a side-effecting attempt may be sent again
 * (must[3]).
 *
 * Only these two are safe, and for opposite reasons: `prepared` means the
 * request never left, so nothing can be duplicated; `compensated` means the
 * effect happened and was undone, so the key is settled rather than free.
 *
 * The other three refuse. `sent` is the case must[3] exists for — the request
 * left and no receipt came back, so a retry may commit the effect twice.
 * `confirmed` means it already committed, and `ambiguous` is what
 * reconciliation is for, which is precisely a state retrying cannot resolve.
 */
const RETRY_SAFE_LEDGER_STATES: readonly LedgerState[] = Object.freeze(['prepared', 'compensated'])

/**
 * Decide whether one failure may be retried (acceptance[0], must[2], must[3]).
 *
 * Checked in refusal order, strongest first. A malformed request and a policy
 * denial are decisions nobody should retry past. An unsettled side effect is
 * refused before the status is read at all: a `503` that may have charged a
 * card is not a free retry, which is must[3].
 * @param facts - what the failing layer observed.
 * @returns the verdict, naming the reason when the failure is permanent.
 */
export function classifyFailure(facts: FailureFacts): RetryVerdict {
  if (facts.malformed === true) return { retryable: false, reason: 'invalid-input' }
  if (facts.denied === true) return { retryable: false, reason: 'policy-denied' }
  // must[3]: a side-effecting attempt is retryable only under an idempotency
  // guarantee, and the ledger is the only thing that can give one. Absence of
  // a verdict is not a guarantee — it is the ambiguity P4-12 exists to settle.
  if (facts.sideEffecting === true && (facts.ledger === undefined || !RETRY_SAFE_LEDGER_STATES.includes(facts.ledger))) {
    return { retryable: false, reason: 'effect-unsettled' }
  }
  const { status } = facts
  if (status !== undefined && status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.includes(status)) {
    return { retryable: false, reason: 'client-error' }
  }
  return { retryable: true }
}

/**
 * Whether this attempt spends a retry from the run's budget (must[2]).
 *
 * A HEDGE does not. Hedging races a second attempt against one still in
 * flight, so the pair is one logical attempt made twice — charging both would
 * make hedging cost double and let a hedging deployment exhaust its budget at
 * half the failures. A retry follows a finished attempt and does spend.
 *
 * This is the RULE half of the §12.46-B split: P5-04 owns the producer that
 * tags a hedged attempt, and BLOCKED-166 records that without the tag this
 * function has a live caller and no reachable input.
 * @param facts - what the layer observed, including whether this is a hedge.
 * @returns true when the attempt should be charged to the budget.
 */
export function spendsRetryBudget(facts: FailureFacts): boolean {
  return facts.hedged !== true
}
