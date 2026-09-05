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
} from './types.ts'
export {
  admitRegistration,
  canResumeAgainst,
  computeDefinitionDigest,
  declaresNestedCall,
  isSelfRecursive,
} from './version.ts'
export type { RegistrationOutcome, RegistrationRefusalReason } from './version.ts'
export { DefinitionRegistry } from './store.ts'
export type { StoreOutcome, StoreRefusalReason } from './store.ts'
export { applyChildFailure, cancelPropagationForNested, inheritWorkerLimits, planNestedRun } from './nesting.ts'
export type { CancelPropagation, ChildFailureOutcome, ChildFailurePolicy, InheritedWorkerLimits } from './nesting.ts'
