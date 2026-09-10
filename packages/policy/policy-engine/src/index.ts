/**
 * Epic P2-05's policy decision vocabulary and its monotonic composition rule.
 *
 * Contract stage: types and pure decisions, with no engine and no Cordis
 * registration. The Cedar provider that answers a {@link PolicyRequest} is
 * `@deepseek-ai/dsh-policy-engine-cedar`, and the enforcement point that acts
 * on a {@link ClosedDecision} belongs to the Trust Kernel — both are the later
 * stages, and keeping them out of this package is what makes the composition
 * rule testable as a rule rather than as a claim about Cedar.
 * @module @deepseek-ai/dsh-policy-engine
 */

export type * from './types.ts'
export * from './evaluate.ts'
