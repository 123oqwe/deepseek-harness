/**
 * Names and report fields the P2-03 nested-token driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-03-nested-token/shared
 */

/** A plugin tool that, inside its own body, writes a file through `ToolRuntime.execute` under the token it was admitted with. */
export const PROBE_TOOL = 'a462_nesting_probe'

/** The call id of the model's call to the probe. */
export const PROBE_CALL = 'a462-probe-call'

/** The call id the probe gives its nested `write`. */
export const NESTED_CALL = 'a462-nested-write'

/** The call id of the model's own `write`, the control. */
export const NATIVE_CALL = 'a462-native-write'

/** The file the nested `write` creates in the working directory. */
export const NESTED_FILE = 'a462-nested.txt'

/** The file the model's own `write` creates in the working directory. */
export const NATIVE_FILE = 'a462-native.txt'

/** The text either `write` puts in its file. */
export const WRITTEN = 'A-462: one write'

/** What the nested `write` returned to the probe, or the message it threw. */
export interface NestedOutcome {
  readonly isError?: boolean
  readonly text?: string
  readonly thrown?: string
}

/** What the driver prints. */
export interface NestedTokenReport {
  /** How many times the probe's body ran, and whether it held a capability token when it did. */
  readonly probe: { readonly runs: number; readonly tokenPresented: boolean }
  /** What the nested `write` returned. */
  readonly nested: NestedOutcome | null
  /** Each write observed on disk for the two `write` call ids, with whether a manifest for that call id was in any session log at that moment. */
  readonly observed: readonly { readonly callId: string; readonly manifestBefore: boolean }[]
  /** Every manifest any session appended for the three call ids, after both turns. */
  readonly manifests: readonly { readonly actionId: string; readonly capability: string }[]
  /** Every decision the kernel audited for the three call ids. */
  readonly decisions: readonly { readonly actionId: unknown; readonly effect: unknown }[]
  /** Whether each file exists after both turns. */
  readonly files: { readonly native: boolean; readonly nested: boolean }
  /** The tool names the operator was asked about, in order. */
  readonly operatorAsked: readonly string[]
}
