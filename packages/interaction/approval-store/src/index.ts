/**
 * The durable approval queue's contract (Epic P2-07): an approval's six
 * states and the moves between them, the record a store keeps, the store
 * operations every provider implements, and the pure decisions each provider
 * applies — so an approval asked in one turn or process can be decided,
 * consumed at most once, or expire in another.
 *
 * This package is the Service Definition. Its SQLite provider is `./sqlite`;
 * `@deepseek-ai/dsh-user-approval` records every ask through it, and the SDK
 * server lists and decides approvals from it.
 * @module @deepseek-ai/dsh-approval-store
 */

import type {} from '@deepseek-ai/cordis'
import type { ApprovalRecord, ApprovalStoreContract } from './types.ts'

/**
 * The mounted approval store, published by whichever provider a profile
 * mounts. Declared here rather than in a provider so the name means the
 * contract, and two providers cannot disagree about what the service is.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    approvalStore: ApprovalStoreContract
  }
  interface Events {
    /**
     * An approval was recorded or moved. Every provider emits this after each
     * `request`, and after each `decide`, `revoke` or `consume` it accepted
     * (never after a refused one), so an asker waiting for its approval and an
     * SDK client watching approvals learn of a decision another client made.
     * Only moves made through this process's store are emitted; a move
     * another process makes in a shared store is seen on the next read.
     * @mode emit
     * @param record - the approval as recorded, or after its move.
     */
    'approval-store/changed'(record: ApprovalRecord): void
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
