/**
 * Deriving a nested run's worker limits from its parent's budget
 * (Epic P4-09 must[3], acceptance[1], acceptance[2]).
 *
 * `./types.ts` decides whether a nested run may start and with what budget.
 * This module turns that budget into the concrete limits a worker is spawned
 * with, and states what a parent's cancellation and a child's failure mean.
 *
 * @module @deepseek-ai/dsh-workflow-registry/nesting
 */

import { admitNestedRun } from './types.ts'
import type { DefinitionDigest, NestingDecision, NestingLimits, RunBudget } from './types.ts'

/** The subset of a worker's limits a nested run inherits. */
export interface InheritedWorkerLimits {
  readonly maxConcurrentAgents: number
  readonly maxTotalAgents: number
}

/**
 * Derive a child's worker limits from an admitted nesting decision.
 *
 * `maxTotalAgents` comes from the child's DECAYED budget, not from the
 * deployment ceiling: the ceiling bounds any single run, while the budget
 * bounds this run plus everything it spawns. Spawning a child with the ceiling
 * would let a tree of nested runs each start a full allowance, and the total
 * would exceed every limit that was supposed to bound it.
 *
 * Concurrency is inherited unchanged rather than divided. It bounds how much
 * runs at once, not how much runs in total, so a child that is allowed fewer
 * agents overall is not thereby entitled to less parallelism among them.
 * @param decision - an admitted nesting decision.
 * @param parentLimits - the parent worker's limits.
 * @returns the child worker's limits.
 */
export function inheritWorkerLimits(
  decision: Extract<NestingDecision, { admitted: true }>,
  parentLimits: InheritedWorkerLimits,
): InheritedWorkerLimits {
  return {
    maxConcurrentAgents: parentLimits.maxConcurrentAgents,
    maxTotalAgents: Math.min(decision.childBudget.agentsRemaining, parentLimits.maxTotalAgents),
  }
}

/** What a parent's cancellation means for a nested child (acceptance[1]). */
export type CancelPropagation = 'cancel-child' | 'leave-child-running'

/**
 * Whether a parent's cancellation reaches a nested child.
 *
 * Always `cancel-child`, and the function exists to make that a stated
 * decision rather than an omission. A nested run holds budget drawn from its
 * parent's allowance, so a child that outlived a cancelled parent would keep
 * spending an allowance nobody is watching, and no later accounting could
 * attribute it.
 *
 * A DETACHED run is a different thing and is not nested (must[2]): it is held
 * by the Run service and survives a UI disconnect precisely because no parent
 * owns its budget.
 * @returns the propagation a nested child receives.
 */
export function cancelPropagationForNested(): CancelPropagation {
  return 'cancel-child'
}

/** How a parent reacts to a nested child failing (acceptance[2]). */
export type ChildFailurePolicy = 'fail-parent' | 'continue-parent'

/** The outcome of applying a declared child-failure policy. */
export type ChildFailureOutcome =
  | { readonly parentContinues: false }
  | { readonly parentContinues: true; readonly recordedFailure: true }

/**
 * Apply a nested child's declared failure policy (acceptance[2]).
 *
 * `continue-parent` still RECORDS the failure. A policy that let a parent
 * ignore a failed child would make the child's work indistinguishable from
 * work that never ran, and a parent reporting success while a declared child
 * failed silently is the outcome this clause exists to prevent.
 * @param policy - the policy the definition declared.
 * @returns whether the parent continues, and that the failure is recorded.
 */
export function applyChildFailure(policy: ChildFailurePolicy): ChildFailureOutcome {
  if (policy === 'fail-parent') return { parentContinues: false }
  return { parentContinues: true, recordedFailure: true }
}

/**
 * Decide a nested run and derive its limits in one step.
 *
 * Provided so a caller cannot admit a run and then spawn it with the wrong
 * limits: the only way to obtain child limits is to have been admitted, and
 * the admission carries the budget those limits are derived from.
 * @param parent - the parent's remaining budget.
 * @param childDigest - the definition to nest.
 * @param ancestors - digests on the chain, root first.
 * @param limits - the deployment's ceilings.
 * @param parentLimits - the parent worker's limits.
 * @returns the child's limits and budget, or the refusal.
 */
export function planNestedRun(
  parent: RunBudget,
  childDigest: DefinitionDigest,
  ancestors: readonly DefinitionDigest[],
  limits: NestingLimits,
  parentLimits: InheritedWorkerLimits,
): { readonly admitted: true; readonly budget: RunBudget; readonly workerLimits: InheritedWorkerLimits }
  | Extract<NestingDecision, { admitted: false }> {
  const decision = admitNestedRun(parent, childDigest, ancestors, limits)
  if (!decision.admitted) return decision
  return {
    admitted: true,
    budget: decision.childBudget,
    workerLimits: inheritWorkerLimits(decision, parentLimits),
  }
}
