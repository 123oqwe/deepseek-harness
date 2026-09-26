/**
 * Names and report fields the P4-07 nested-after-takeover driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p4-07-nested-after-takeover/shared
 */

/** A plugin tool that, inside its body, has another worker take the Run's lease and then writes a file through `ToolRuntime.execute`. */
export const PROBE_TOOL = 'a473_takeover_probe'

/** The call id of the model's call to the probe. */
export const PROBE_CALL = 'a473-probe-call'

/** The call id the probe gives its nested `write`. */
export const NESTED_CALL = 'a473-nested-write'

/** The call id of the model's own `write` after the takeover, the control. */
export const NATIVE_CALL = 'a473-native-write'

/** The file the nested `write` would create. */
export const NESTED_FILE = 'a473-nested.txt'

/** The file the model's own `write` would create. */
export const NATIVE_FILE = 'a473-native.txt'

/** The phrase a dispatch refusal after a takeover carries. */
export const TAKEOVER_REFUSAL = 'another host took it over'

/** What the driver prints. */
export interface NestedAfterTakeoverReport {
  /** Whether the Run held a lease before the takeover, and whether the other worker acquired it. */
  readonly takeover: { readonly held: boolean; readonly acquired: boolean } | null
  /** The root agent's `runLease.mayWrite` after the turn, or `null` when it holds no lease. */
  readonly mayWrite: boolean | null
  /** What the nested `write` returned, or the message it threw. */
  readonly nested: { readonly isError?: boolean; readonly text?: string; readonly thrown?: string } | null
  /** Every tool result the root session recorded. */
  readonly results: readonly { readonly callId: string; readonly isError: boolean; readonly text: string }[]
  /** Whether each file exists after the turn. */
  readonly files: { readonly nested: boolean; readonly native: boolean }
}
