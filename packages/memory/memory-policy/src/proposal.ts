/**
 * P6-03 proposal policy: decide a candidate memory write's disposition
 * (`must[1]`). A proposal is auto-accepted, sent to human review, or rejected;
 * `must[2]` sends anything sensitive — including a write whose sensitivity
 * nobody stated — to review rather than into active memory.
 *
 * Pure: it reads the proposal's own stated facts and a deployment policy, and
 * returns a decision. Acting on that decision (storing `pending` or `active`,
 * or refusing) is `@deepseek-ai/dsh-memory`'s `propose`. Whether a claim traces
 * to anything is P6-02's `isTraceable`, applied by `propose` before this runs;
 * this module does not restate it.
 * @module @deepseek-ai/dsh-memory-policy/proposal
 */

import type { MemoryProposeRequest } from '@deepseek-ai/dsh-memory'

/** What the policy decides to do with a proposal (`must[1]`). */
export type MemoryProposalDisposition = 'auto-accept' | 'review' | 'reject'

/** A policy decision and the reason it was reached, for the audit and the reviewer. */
export interface MemoryProposalDecision {
  readonly disposition: MemoryProposalDisposition
  readonly reason: string
}

/**
 * Deployment-varying thresholds the proposal policy decides against. A field
 * here is validated `Config` on the policy service, never a constant: a shared
 * deployment wants a different review bar than a personal one.
 */
export interface MemoryProposalThresholds {
  /**
   * A `derived` claim whose writer confidence is below this goes to review
   * rather than active memory; weak inference is not auto-admitted.
   */
  readonly reviewBelowConfidence: number
}

/**
 * Decide a proposal's disposition (`must[0]`, `must[1]`, `must[2]`).
 *
 * Order is deliberate. Completeness is decided first: `must[0]` requires a
 * proposal to state its intended use and its TTL, so one that omits either is
 * held for review before the sensitivity and confidence rules run. Then
 * sensitivity is decided before confidence, because a sensitive claim goes to
 * review however sure its writer is. A `user-asserted` claim is confidence 1 by
 * the vocabulary's definition, so only a `derived` claim can fall to the
 * confidence bar. Evidence (`origin`) is required by the request type and
 * checked by P6-02's `isTraceable` before this runs, so it is not re-checked.
 * @param request - the candidate write; assumed already traceable (P6-02's `isTraceable`).
 * @param thresholds - the deployment's review thresholds.
 * @returns the disposition and the reason for it.
 */
export function decideProposal(
  request: MemoryProposeRequest,
  thresholds: MemoryProposalThresholds,
): MemoryProposalDecision {
  // must[0]: a proposal must state its intended use. An omitted purpose is
  // unstated, not a chosen absence, so it is held for review rather than
  // auto-admitted.
  if (request.purpose === undefined) {
    return { disposition: 'review', reason: 'a proposal that states no intended use is held for review (must[0])' }
  }
  // must[0]: a proposal must state its TTL. An omitted `validUntil` is unstated;
  // "no expiry" is a decision the writer states as `validUntil: null`, so only
  // an omitted TTL — not an explicit null — is held for review.
  if (request.validUntil === undefined) {
    return { disposition: 'review', reason: 'a proposal that states no TTL is held for review; "no expiry" is stated as validUntil: null (must[0])' }
  }
  // must[2]: sensitive content is never auto-admitted to active memory.
  if (request.sensitivity === 'sensitive') {
    return { disposition: 'review', reason: 'sensitive content requires human review before it enters active memory' }
  }
  // must[2], fail-closed: a write whose sensitivity nobody stated is treated as
  // not auto-admissible — the same direction the record vocabulary gives an
  // unstated sensitivity, so an unassessed write cannot slip into an index.
  if (request.sensitivity === undefined) {
    return { disposition: 'review', reason: 'unstated sensitivity is not auto-admitted; a reviewer must assess it' }
  }
  // A weakly-inferred claim goes to review; a person's assertion never does.
  if (request.origin.kind === 'derived' && request.origin.confidence < thresholds.reviewBelowConfidence) {
    return { disposition: 'review', reason: 'derived claim below the review-confidence threshold' }
  }
  // normal sensitivity, traceable, and sufficiently confident.
  return { disposition: 'auto-accept', reason: 'normal sensitivity and sufficient evidence' }
}
