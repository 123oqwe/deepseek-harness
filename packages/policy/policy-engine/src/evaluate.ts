/**
 * The monotonic composition rule (Epic P2-05 must[2]): how one engine answer
 * and any number of plugin constraints combine into the decision an
 * enforcement point acts on.
 *
 * Pure and total. Nothing here reads a policy file, mounts a service, or knows
 * which engine produced the answer it is given — the rule is about what may
 * happen to a decision after it exists, and it holds for every engine.
 * @module @deepseek-ai/dsh-policy-engine/evaluate
 */

import type {
  ClosedDecision,
  PolicyConstraint,
  PolicyEvaluation,
  PolicyRequest,
  PolicySetDigest,
} from './types.ts'

/**
 * One constraint's contribution, with a throw counted as its own refusal.
 *
 * A constraint is plugin-supplied and its body is arbitrary, so throwing is a
 * thing a plugin can do. Left to propagate, the exception leaves the
 * enforcement point entirely: the action does not run, so nothing fails open,
 * but no DECISION is produced either — no named deny, no audit record naming
 * the constraint, and one plugin breaks every dispatch that reaches here.
 * Converting it keeps must[2]'s rule exactly as written: a plugin narrows, and
 * a plugin that fails narrows.
 *
 * The reason names the constraint and carries the throw's message, because the
 * alternative is an operator reading `constrained-by-plugin` with no way to
 * tell which plugin, or that it threw rather than refused. It is never folded
 * into `policy-unavailable`: the engine was mounted and it answered.
 * @param constraint - the registered constraint to consult.
 * @param request - the request it answers.
 * @returns its reason to deny, the throw rendered as one, or undefined to abstain.
 */
function reasonFrom(constraint: PolicyConstraint, request: PolicyRequest): string | undefined {
  try {
    return constraint(request)
  } catch (error) {
    const name = constraint.name === '' ? '<anonymous constraint>' : constraint.name
    return `${name} threw: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Combine an engine's evaluation with the plugin constraints registered for it
 * (must[2]).
 *
 * The rule is one sentence: **a constraint may only make the decision
 * narrower.** A `deny` stays denied whatever any constraint says; a `permit` or
 * an `ask` becomes a `deny` as soon as ONE constraint objects; and no
 * constraint can produce a `permit`, because {@link PolicyConstraint} has no
 * shape that carries one.
 *
 * Order therefore does not matter, and that is the property this function
 * exists to have rather than a convenience: `dsh-permission-rules` — the
 * nearest thing to this in the wild — evaluates ordered allow/deny rules by
 * FIRST MATCH, so a rule nearer the user overrides a baseline deny. Under that
 * shape, whether an action is permitted depends on the order two independently
 * installed plugins happened to load in.
 *
 * Constraints are evaluated even when the engine already denied. Not for the
 * decision, which cannot change, but for the audit: an operator asking why an
 * action was refused is told everything that refused it, not only whichever
 * refusal was reached first.
 * @param evaluation - the engine's own answer, with its audit-only explain.
 * @param constraints - every registered plugin constraint, in any order.
 * @param request - the request all of them answer.
 * @returns the composed decision and the reasons every constraint gave.
 */
export function composeDecision(
  evaluation: PolicyEvaluation,
  constraints: readonly PolicyConstraint[],
  request: PolicyRequest,
): { readonly decision: ClosedDecision; readonly constraintReasons: readonly string[] } {
  const constraintReasons: string[] = []
  for (const constraint of constraints) {
    const reason = reasonFrom(constraint, request)
    if (reason !== undefined) constraintReasons.push(reason)
  }
  if (evaluation.decision.effect === 'deny' || constraintReasons.length === 0) {
    return { decision: evaluation.decision, constraintReasons }
  }
  return {
    decision: {
      effect: 'deny',
      reason: 'constrained-by-plugin',
      policySet: evaluation.decision.policySet,
    },
    constraintReasons,
  }
}

/**
 * The decision to act on when no policy engine can be consulted (acceptance[2]).
 *
 * Deny, by name. The provider is an ordinary plugin and may be unmounted like
 * any other — what may not be lost is the ENFORCEMENT, so the enforcement point
 * answers for itself when its engine is gone. A composition that silently
 * permitted here would turn unmounting one plugin into removing every policy in
 * the deployment, which is the difference between a service being optional and
 * a control being optional.
 *
 * `policySet` is the caller's last known digest, or the empty digest when it
 * never had one: a refusal still records WHICH policy set it failed to reach,
 * so a replay can tell "the engine was gone" from "the engine said no".
 * @param lastKnown - the policy-set digest last observed, if any.
 * @returns the closed refusal.
 */
export function decisionWhenUnavailable(lastKnown: PolicySetDigest | undefined): ClosedDecision {
  return {
    effect: 'deny',
    reason: 'policy-unavailable',
    ...lastKnown === undefined ? { policySet: EMPTY_POLICY_SET } : { policySet: lastKnown },
  }
}

/**
 * The digest of "no policy set at all".
 *
 * A named constant rather than an empty string at each call site, so a replay
 * comparing digests can recognize the state instead of matching a falsy value.
 */
export const EMPTY_POLICY_SET = 'sha256-empty' as PolicySetDigest

/**
 * Whether a decision may be acted on without a human answer.
 *
 * A one-line predicate with a name, because the mistake it prevents is a real
 * one: `effect !== 'deny'` reads as "allowed" and silently admits `ask`, which
 * is the state where a human has NOT yet answered.
 * @param decision - the composed decision.
 * @returns true only for a permit.
 */
export function isImmediatelyAllowed(decision: ClosedDecision): boolean {
  return decision.effect === 'permit'
}
