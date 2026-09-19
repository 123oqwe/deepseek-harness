/**
 * P2-10 must[1]'s shadow evaluation and diff explain: two pure functions over
 * answers and compiled sets a caller already holds.
 *
 * Neither runs an engine. A shadow evaluation compares two evaluations the
 * caller obtained; a diff compares two compiled sets. That keeps both
 * decidable without a mount, a clock or a policy engine instance, and keeps
 * this package's one runtime dependency on the engine a type-only one.
 *
 * What a shadow is for: a deployment about to change its policy set wants to
 * know what the candidate WOULD have decided, without letting it decide. So
 * the live answer is returned unchanged and the candidate's is reported
 * beside it — never merged, never preferred.
 *
 * Two diffs, at different levels, and only one question each answers. The
 * set-level diff ({@link diffExplain}) says which policies were added,
 * removed or rewritten between two compiled sets. The decision-level one
 * ({@link ShadowOutcome.onlyLive} and {@link ShadowOutcome.onlyShadow}) says
 * which policies each side matched for ONE request — two sets can share every
 * id and still decide a request differently, so the first cannot answer the
 * second.
 *
 * Neither is wired to anything today: no shipped profile asks its engine
 * twice, so nothing calls these. The step that would — evaluating a request
 * against a candidate set — is not in this package and is not anywhere else
 * in the tree either.
 */

import type { ClosedDecision, PolicyEvaluation, PolicyExplain, PolicyId } from '@deepseek-ai/dsh-policy-engine'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CompiledPolicySet } from './compiler.ts'

/** What a shadow run reports: the decision that stands, whether the candidate agreed, and what only the audit may see. */
export interface ShadowOutcome {
  /**
   * The live set's decision, unchanged.
   *
   * Returned verbatim rather than recomputed: the whole value of a shadow run
   * is that it cannot change what happens, and a function that could return
   * the candidate's decision under any condition would not be one.
   */
  readonly decision: ClosedDecision
  /**
   * Whether the candidate would have decided the same way.
   *
   * Compared on what the enforcement point acts on — the effect and its reason
   * — and NOT on `policySet`: the two answers come from different sets by
   * definition, so a whole-decision comparison would report disagreement for
   * every request and say nothing about the policies.
   */
  readonly agrees: boolean
  /**
   * The candidate's explain, for the audit trail only.
   *
   * `PolicyExplain`'s own contract keeps it out of model context, and a
   * shadow's explain is no different: it names policy ids and carries an
   * engine's diagnostics.
   */
  readonly shadow: PolicyExplain
  /**
   * The policies only the LIVE set matched, in id order.
   *
   * `agrees` says whether the two answers landed on the same effect;
   * this and {@link ShadowOutcome.onlyShadow} say what decided them
   * differently, which is what an operator reading a disagreement needs. A
   * set-level diff cannot answer it: two sets can share every policy id and
   * still match different ones for one request.
   *
   * Audit-only, for the same reason the explains it is derived from are.
   */
  readonly onlyLive: readonly PolicyId[]
  /** The policies only the CANDIDATE matched, in id order; audit-only. */
  readonly onlyShadow: readonly PolicyId[]
}

/** What changed between two compiled sets, in the unit an explain reports: the policy id. */
export interface PolicySetDiff {
  /** The pin the earlier set compiled to. */
  readonly beforePin: string
  /** The pin the later set compiled to. */
  readonly afterPin: string
  /** Ids the later set has and the earlier one did not. */
  readonly added: readonly PolicyId[]
  /** Ids the earlier set had and the later one does not. */
  readonly removed: readonly PolicyId[]
  /** Ids both sets have, whose canonical text differs. */
  readonly changed: readonly PolicyId[]
}

/**
 * Evaluate a candidate set beside the live one without letting it decide
 * (must[1]'s shadow half).
 *
 * Both answers come from the caller, which is what makes this decidable
 * without an engine: a deployment that can ask its engine twice can ask this
 * what the difference means.
 * @param live - the answer the enforcement point acted on.
 * @param candidate - the answer the set under consideration gave for the same request.
 * @returns the live decision unchanged, whether the candidate agreed, and the candidate's audit-only explain.
 */
export function shadowEvaluate(live: PolicyEvaluation, candidate: PolicyEvaluation): ShadowOutcome {
  const liveMatched = new Set<string>(live.explain.matched)
  const shadowMatched = new Set<string>(candidate.explain.matched)
  const ordered = (ids: ReadonlySet<string>, absentFrom: ReadonlySet<string>): readonly PolicyId[] =>
    [...ids].filter(id => !absentFrom.has(id)).sort().map(id => brandString<PolicyId>(id))
  return {
    decision: live.decision,
    agrees: live.decision.effect === candidate.decision.effect && live.decision.reason === candidate.decision.reason,
    shadow: candidate.explain,
    onlyLive: ordered(liveMatched, shadowMatched),
    onlyShadow: ordered(shadowMatched, liveMatched),
  }
}

/** The policy ids of a compiled set, in the order its canonical text carries them. */
function idsOf(set: CompiledPolicySet): readonly string[] {
  return Object.keys(set.canonical)
}

/**
 * What changed between two compiled policy sets (must[1]'s diff half).
 *
 * The comparison is over `canonical`, not `policies`: the canonical text is
 * what the pin is taken over, so reformatting a document that says the same
 * thing shows as no change under both — and a diff that disagreed with the
 * pin would leave an operator with two accounts of one upgrade.
 *
 * Ids are reported in ascending order so two runs over the same pair produce
 * the same lists.
 * @param before - the set in force.
 * @param after - the set under consideration.
 * @returns both pins and the ids added, removed and changed between them.
 */
export function diffExplain(before: CompiledPolicySet, after: CompiledPolicySet): PolicySetDiff {
  const beforeIds = new Set(idsOf(before))
  const afterIds = new Set(idsOf(after))
  const brand = (ids: readonly string[]): readonly PolicyId[] => [...ids].sort().map(id => brandString<PolicyId>(id))
  return {
    beforePin: before.pin,
    afterPin: after.pin,
    added: brand(idsOf(after).filter(id => !beforeIds.has(id))),
    removed: brand(idsOf(before).filter(id => !afterIds.has(id))),
    changed: brand(idsOf(after).filter(id => beforeIds.has(id) && before.canonical[id] !== after.canonical[id])),
  }
}
