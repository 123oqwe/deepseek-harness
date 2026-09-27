/**
 * Names and report fields the P0-02 no-kernel dispatch driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p0-02-no-kernel-dispatch/shared
 */

/** The probe: it declares `filesystem-read`, which the shipped risk rules classify `read`, so no approval is asked. */
export const PROBE_TOOL = 'b672_probe'

/**
 * The three dispatch paths the driver reaches the probe through: the model's
 * own call, a call from a `run_code` program, and a plugin's direct call
 * through the public `ToolRuntime.execute` seam (B-675).
 */
export const DISPATCH_MODES = ['native', 'code-mode', 'direct'] as const

/** One dispatch path. */
export type DispatchMode = typeof DISPATCH_MODES[number]

/** Whether the driver pins a Trust Kernel before the tree mounts. */
export const KERNEL_STATES = ['absent', 'pinned'] as const

/** One kernel state. */
export type KernelState = typeof KERNEL_STATES[number]

/** The tool call id the scripted model gives the native probe call. */
export const NATIVE_CALL_ID = 'b672-native'

/** The tool call id the scripted model gives the code-mode turn's `run_code` call. */
export const RUN_CODE_CALL_ID = 'b672-run-code'

/** The call id of the direct call a plugin makes on behalf of the root agent, presenting the session's token when one was issued. */
export const DIRECT_AGENT_CALL_ID = 'b675-direct-agent'

/** The call id of the direct call a plugin makes with no agent. */
export const DIRECT_PLAIN_CALL_ID = 'b675-direct-plain'

/** What one direct call returned, or the message it threw. */
export interface DirectOutcome {
  readonly callId: string
  readonly isError?: boolean
  readonly text?: string
  readonly thrown?: string
}

/** What the driver prints for one launch, read from the root session's log and its own records. */
export interface NoKernelReport {
  readonly mode: DispatchMode
  readonly kernel: KernelState
  /** The call id of every run of the probe's body. */
  readonly runs: readonly string[]
  /** Every `tool/result` block of the root session: its call id, whether it is an error, and its text. */
  readonly results: readonly { readonly callId: string; readonly isError: boolean; readonly text: string }[]
  /** What each direct call ended with; empty outside the `direct` mode. */
  readonly direct: readonly DirectOutcome[]
}
