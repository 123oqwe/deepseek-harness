/**
 * Registered workflow definitions, versions, and nested-run limits
 * (Epic P4-09).
 *
 * @module @deepseek-ai/dsh-workflow-registry
 */

export { admitNestedRun, resolveDefinition } from './types.ts'
export type {
  DefinitionDigest,
  DefinitionName,
  NestingDecision,
  NestingDenialReason,
  NestingLimits,
  RegisteredDefinition,
  ResolveFailureReason,
  ResolveOutcome,
  RunBudget,
  RunDefinitionRef,
  SignerIdentity,
  WorkflowRunId,
} from './types.ts'
export {
  admitRegistration,
  canResumeAgainst,
  computeDefinitionDigest,
  declaresNestedCall,
  isSelfRecursive,
} from './version.ts'
export type { RegistrationOutcome, RegistrationRefusalReason } from './version.ts'
