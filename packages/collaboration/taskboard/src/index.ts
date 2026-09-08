/**
 * Task coordination primitives (Epic P5-11).
 *
 * @module @deepseek-ai/dsh-taskboard
 */

export { decideClaim, decideRelease, isClaimCurrent, validateTaskGraph } from './types.ts'
export type {
  ArtifactRef,
  Attempt,
  ClaimDecision,
  ClaimDenialReason,
  GraphDefectReason,
  GraphValidation,
  ReleaseDecision,
  ReleaseDenialReason,
  Task,
  TaskId,
  TaskStatus,
  VerificationStatus,
  WorkerId,
} from './types.ts'
export type { TaskStoreContract } from './store.ts'
export { TaskStore } from './store.ts'
export type { ReceiptOutcome, ReceiptRejectionReason, SubmitOutcome, SubmitRefusalReason, TaskReceipt } from './store.ts'
