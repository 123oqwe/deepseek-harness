/**
 * Task coordination primitives (Epic P5-11).
 *
 * @module @deepseek-ai/dsh-taskboard
 */

export { decideClaim, isClaimCurrent, validateTaskGraph } from './types.ts'
export type {
  ArtifactRef,
  Attempt,
  ClaimDecision,
  ClaimDenialReason,
  GraphDefectReason,
  GraphValidation,
  Task,
  TaskId,
  TaskStatus,
  VerificationStatus,
  WorkerId,
} from './types.ts'
