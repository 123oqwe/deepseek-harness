/**
 * Worker leases and fencing tokens (Epic P4-07).
 *
 * @module @deepseek-ai/dsh-lease
 */

export { checkFencing, isReclaimable } from './types.ts'
export type {
  FencingDecision,
  FencingDenialReason,
  FencingToken,
  Lease,
  LeaseEpoch,
  WorkerId,
  WorkItemId,
} from './types.ts'
