/**
 * Names and report fields the P2-03 manifest-class driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-03-manifest-class/shared
 */

/** A probe tool that declares no risk domain tags, so the risk gate cannot classify it. */
export const UNCLASSIFIED_TOOL = 'a443_unclassified_probe'

/** The control probe: the same tool, except that it declares `filesystem-read`, which the shipped rules classify as `read`. */
export const CLASSIFIED_TOOL = 'a443_classified_probe'

/** How the driver reaches the probes: the model calls each directly, or a `run_code` program calls both. */
export const MANIFEST_CLASS_MODES = ['native', 'code-mode'] as const

/** One way of reaching the probes. */
export type ManifestClassMode = typeof MANIFEST_CLASS_MODES[number]

/** One `action/manifest-appended` event for a probe. */
export interface ManifestRow {
  readonly capability: string
  readonly origin: string
  readonly sideEffectClass: string
  readonly classified: boolean
  readonly requiresApproval: boolean
}

/** One `action/risk-gated` event's data. */
export interface RiskGatedRow {
  readonly actionId: string
  readonly riskClass: string
  readonly preset: string
  readonly decision: string
}

/** What the driver prints for one mode, read from the root session's log and the driver's own counters. */
export interface ManifestClassReport {
  readonly mode: ManifestClassMode
  /** Every manifest the root session appended for either probe, in order. */
  readonly manifests: readonly ManifestRow[]
  /** Every `action/risk-gated` the root session recorded, in order. */
  readonly riskGated: readonly RiskGatedRow[]
  /** Every `approval/asked` the root session recorded, with its paired `approval/decided` outcome or `null`. */
  readonly asked: readonly { readonly toolName: string; readonly outcome: string | null }[]
  /** How many times each probe's body ran. */
  readonly runs: { readonly unclassified: number; readonly classified: number }
  /** The tool names the operator was asked about, in order. */
  readonly operatorAsked: readonly string[]
}
