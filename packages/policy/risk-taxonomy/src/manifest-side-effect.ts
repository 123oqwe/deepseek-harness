/**
 * The side-effect class an action manifest records for each risk class
 * (P2-03 acceptance[2]).
 *
 * The risk gate classifies an action by the organisation policy's rules for
 * its declared domain tags; the manifest records the class this table gives
 * for that verdict, so the two cannot describe one action differently. The
 * table lives here, in the one package both sides read, as the delegate ruled
 * on 2026-09-26.
 *
 * It is total over the eight risk classes and monotone: in ascending risk
 * order the manifest class never falls in the manifest's own order (`read`,
 * `write`, `network`, `process`, `destructive`), so no choice of domain tag
 * earns a lower manifest class than a lower-risk tag would. No risk class
 * yields `process`, which names a mechanism a risk class does not express.
 * @module @deepseek-ai/dsh-risk-taxonomy/manifest-side-effect
 */
import type { ManifestSideEffectClass, RiskClass } from './types.ts'

/** The manifest side-effect class each risk class is recorded as. */
export const SIDE_EFFECT_CLASS_BY_RISK: Readonly<Record<RiskClass, ManifestSideEffectClass>> = Object.freeze({
  'read': 'read',
  'local-reversible': 'write',
  'internal-write': 'write',
  'external-communication': 'network',
  'destructive': 'destructive',
  'financial': 'destructive',
  'security-sensitive': 'destructive',
  'safety-critical': 'destructive',
})

/**
 * The manifest side-effect class a risk class is recorded as.
 * @param riskClass - the class the risk gate classified the action into.
 * @returns the class the action's manifest records.
 */
export function sideEffectClassOf(riskClass: RiskClass): ManifestSideEffectClass {
  return SIDE_EFFECT_CLASS_BY_RISK[riskClass]
}
