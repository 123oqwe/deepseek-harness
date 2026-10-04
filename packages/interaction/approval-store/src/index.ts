/**
 * The durable approval queue's contract (Epic P2-07): an approval's six
 * states and the moves between them, the record a store keeps, the store
 * operations every provider implements, and the pure decisions each provider
 * applies — so an approval asked in one turn or process can be decided,
 * consumed at most once, or expire in another.
 *
 * This package is the Service Definition. Its SQLite provider and the
 * consumers that write through to it (`@deepseek-ai/dsh-user-approval`, the
 * Run that waits for an approval, the SDK's list and decide requests) follow
 * in later slices.
 * @module @deepseek-ai/dsh-approval-store
 */

import type {} from '@deepseek-ai/cordis'
import type { ApprovalStoreContract } from './types.ts'

/**
 * The mounted approval store, published by whichever provider a profile
 * mounts. Declared here rather than in a provider so the name means the
 * contract, and two providers cannot disagree about what the service is.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    approvalStore: ApprovalStoreContract
  }
}

export type * from './types.ts'
export {
  APPROVAL_TRANSITIONS,
  applyApprovalTransition,
  effectiveApprovalState,
  isPendingApproval,
  isTerminalApprovalState,
  newApprovalRecord,
  viewerMayAccess,
} from './transitions.ts'
