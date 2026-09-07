/**
 * Worker leases and fencing tokens (Epic P4-07).
 *
 * @module @deepseek-ai/dsh-lease
 */

export { default } from './plugin.ts'
export { checkFencing, isReclaimable } from './types.ts'
export { describeFencingRejection, LeaseStore } from './store.ts'
export type { AcquireDenialReason, AcquireResult, FencingRejectionRecord, LeaseStoreContract, RenewDenialReason, RenewResult } from './store.ts'
export type {
  FencingDecision,
  FencingDenialReason,
  FencingToken,
  Lease,
  LeaseEpoch,
  WorkerId,
  WorkItemId,
} from './types.ts'
