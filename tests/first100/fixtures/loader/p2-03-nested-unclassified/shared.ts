/**
 * Names and report fields the P2-03 nested-unclassified driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-03-nested-unclassified/shared
 */

/** A tool that declares no risk domain tags, so the risk gate cannot classify it, and writes one file. */
export const WRITER_TOOL = 'a471_unclassified_writer'

/** A plugin tool, declared `filesystem-read`, that calls the writer through `ToolRuntime.execute` from inside its body. */
export const PROBE_TOOL = 'a471_nesting_probe'

/** The call id of the model's own call to the writer, the control. */
export const DIRECT_CALL = 'a471-direct-call'

/** The call id of the model's call to the probe. */
export const PROBE_CALL = 'a471-probe-call'

/** The call id the probe gives its nested call to the writer. */
export const NESTED_CALL = 'a471-nested-call'

/** Which turn the driver is in: the model calls the writer itself, or through the probe. */
export type Phase = 'direct' | 'nested'

/** What the driver prints, read from the root session's log and the driver's own records. */
export interface NestedUnclassifiedReport {
  /** Each run of the writer's body: in which turn, under which call id. */
  readonly runs: readonly { readonly phase: Phase; readonly callId: string }[]
  /** Each approval request the operator answered: in which turn, about which tool. */
  readonly operatorAsked: readonly { readonly phase: Phase; readonly toolName: string }[]
  /** Every `approval/asked` the root session recorded, with its paired `approval/decided` outcome or `null`. */
  readonly asked: readonly { readonly toolName: string; readonly outcome: string | null }[]
  /** Every `action/risk-gated` the root session recorded. */
  readonly riskGated: readonly { readonly actionId: string; readonly riskClass: string; readonly decision: string }[]
  /** Whether the probe held a capability token, and what its nested call returned or threw. */
  readonly probe: { readonly tokenPresented: boolean; readonly nested: { readonly isError?: boolean; readonly text?: string; readonly thrown?: string } | null }
}
