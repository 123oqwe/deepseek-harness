/**
 * Names and report fields the P2-03 gate-approval driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-03-gate-approval/shared
 */

/** A probe tool that declares no risk domain tags, so the risk gate cannot classify it. */
export const UNCLASSIFIED_TOOL = 'a442_unclassified_probe'

/** The control probe: the same tool, except that it declares `filesystem-read`, which the shipped rules classify. */
export const CLASSIFIED_TOOL = 'a442_classified_probe'

/** The call id of the unclassified probe's call. */
export const UNCLASSIFIED_CALL = 'a442-unclassified-call'

/** The call id of the control probe's call. */
export const CLASSIFIED_CALL = 'a442-classified-call'

/** The text either probe returns when its body runs. */
export const PROBE_RAN = 'probe ran'

/** One `action/risk-gated` event's data. */
export interface RiskGatedRow {
  readonly actionId: string
  readonly riskClass: string
  readonly preset: string
  readonly decision: string
}

/** What the driver prints, read from the root session's log and the driver's own counters. */
export interface GateApprovalReport {
  /** Every `action/risk-gated` the root session recorded, in order. */
  readonly riskGated: readonly RiskGatedRow[]
  /** Every `approval/asked` the root session recorded, with its paired `approval/decided` outcome or `null` when none was recorded. */
  readonly asked: readonly { readonly toolName: string; readonly reason: string | null; readonly outcome: string | null }[]
  /** Every tool result the root session recorded. */
  readonly results: readonly { readonly callId: string; readonly isError: boolean; readonly text: string }[]
  /** How many times each probe's body ran. */
  readonly runs: { readonly unclassified: number; readonly classified: number }
  /** The tool names the operator was asked about, in order. */
  readonly operatorAsked: readonly string[]
}
