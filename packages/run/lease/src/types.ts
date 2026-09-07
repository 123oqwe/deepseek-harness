/**
 * Worker leases, fencing tokens, and the staleness test, as this package's
 * callers have always imported them (Epic P4-07).
 *
 * The declarations and the two rules moved to
 * `@deepseek-ai/dsh-lease-contract` so a consumer can depend on the lease rule
 * without depending on orchestration runtime. Nothing is redeclared here: a
 * second copy of `checkFencing` would be the one-rule-two-implementations shape
 * BLOCKED-136 records, and this is the copy that would decide whether a stale
 * worker may write.
 *
 * @module @deepseek-ai/dsh-lease/types
 */

export { checkFencing, isReclaimable } from '@deepseek-ai/dsh-lease-contract'
export type {
  FencingDecision,
  FencingDenialReason,
  FencingToken,
  Lease,
  LeaseEpoch,
  WorkerId,
  WorkItemId,
} from '@deepseek-ai/dsh-lease-contract'
