/**
 * The risk taxonomy's public surface (P2-04 Provider stage).
 *
 * The Contract stage kept this barrel type-only so nothing re-exported here
 * could execute. The Provider stage is where the classifier becomes reachable
 * by name: a consumer decides an action's risk band by calling `classify` with
 * the organisation policy in force, and `@deepseek-ai/dsh-permission-presets`
 * is what holds and validates that policy.
 *
 * The runtime exports are the classifier and the two ordered tables its
 * results are read against. Nothing here reads a store, a clock or an ambient
 * policy — the policy is a parameter, so the same action under two policies
 * gives two answers and neither is a property of this package.
 *
 * @module @deepseek-ai/dsh-risk-taxonomy
 */
export type * from './types.ts'
export {
  classify,
  riskRank,
  KERNEL_HARD_DENY_CLASSES,
  RISK_CLASSES_BY_ASCENDING_RISK,
} from './classify.ts'
