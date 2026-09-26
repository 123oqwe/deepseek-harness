/**
 * Names and report fields the P0-02 no-kernel dispatch driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p0-02-no-kernel-dispatch/shared
 */

/** The probe: it declares `filesystem-read`, which the shipped risk rules classify `read`, so no approval is asked. */
export const PROBE_TOOL = 'b672_probe'

/** The two dispatch paths the driver reaches the probe through. */
export const DISPATCH_MODES = ['native', 'code-mode'] as const

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

/** What the driver prints for one launch, read from the root session's log and its own records. */
export interface NoKernelReport {
  readonly mode: DispatchMode
  readonly kernel: KernelState
  /** The call id of every run of the probe's body. */
  readonly runs: readonly string[]
  /** Every `tool/result` block of the root session: its call id, whether it is an error, and its text. */
  readonly results: readonly { readonly callId: string; readonly isError: boolean; readonly text: string }[]
}
