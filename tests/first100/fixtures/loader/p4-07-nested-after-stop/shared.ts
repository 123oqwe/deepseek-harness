/**
 * Names and report fields the P4-07 nested-after-stop driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p4-07-nested-after-stop/shared
 */

/** A plugin tool that, inside its body, raises the emergency stop and then writes a file through `ToolRuntime.execute`. */
export const PROBE_TOOL = 'a472_stop_probe'

/** The call id of the model's call to the probe. */
export const PROBE_CALL = 'a472-probe-call'

/** The call id the probe gives its nested `write`. */
export const NESTED_CALL = 'a472-nested-write'

/** The call id of the model's own `write` after the stop, the control. */
export const NATIVE_CALL = 'a472-native-write'

/** The file the nested `write` would create. */
export const NESTED_FILE = 'a472-nested.txt'

/** The file the model's own `write` would create. */
export const NATIVE_FILE = 'a472-native.txt'

/** The phrase a dispatch refusal under an emergency stop carries. */
export const STOP_REFUSAL = 'an emergency stop is in force'

/** What the driver prints. */
export interface NestedAfterStopReport {
  /** What the control plane decided for the stop, serialized. */
  readonly stopDecision: string | null
  /** The root agent's stop gate after the turn. */
  readonly stopGate: string
  /** What the nested `write` returned, or the message it threw. */
  readonly nested: { readonly isError?: boolean; readonly text?: string; readonly thrown?: string } | null
  /** Every tool result the root session recorded. */
  readonly results: readonly { readonly callId: string; readonly isError: boolean; readonly text: string }[]
  /** Whether each file exists after the turn. */
  readonly files: { readonly nested: boolean; readonly native: boolean }
}
