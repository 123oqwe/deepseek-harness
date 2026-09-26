/**
 * Names and report fields the P2-03 approval-census driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-03-approval-census/shared
 */

/** The shipped templates this census boots. */
export const CENSUS_TEMPLATES = ['headless', 'sdk-minimal'] as const

/** One shipped template this census boots. */
export type CensusTemplate = typeof CENSUS_TEMPLATES[number]

/** What `gateActionRisk` decides for one action under one preset, before anyone is asked. */
export type GateDecision = 'hard-denied' | 'asked' | 'allowed-by-preset'

/** One tool the root agent can see: what it declares, how the risk gate classifies it, and what the gate decides under each preset. */
export interface CensusTool {
  readonly name: string
  /** The tool's `riskDomainTags`, or `null` when it declares none. */
  readonly tags: readonly string[] | null
  /** The classifier's verdict, or `null` when no policy service is mounted. */
  readonly classification: { readonly riskClass: string; readonly ground: string; readonly hardDenied: boolean } | null
  /** The gate's decision per preset name; empty when no policy service is mounted. */
  readonly decisions: Readonly<Record<string, GateDecision>>
}

/** What the driver prints for one template. */
export interface CensusReport {
  readonly template: CensusTemplate
  readonly presetsMounted: boolean
  /** The preset table's names in table order; empty when no policy service is mounted. */
  readonly presetNames: readonly string[]
  /** The preset in force for the root agent's session, or `null` when no policy service is mounted. */
  readonly presetInForce: string | null
  readonly tools: readonly CensusTool[]
}
