/**
 * Names and report fields the P2-05 code-mode originator driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-05-code-mode/shared
 */

/** The file the driver writes into its working directory and the program reads. */
export const READ_FILE = 'p2-05-code-mode.txt'

/** The one line that file holds. */
export const READ_LINE = 'P2-05 code mode: one read from inside a run_code program'

/** The call id of the model's own `run_code` call. */
export const PROGRAM_CALL = 'a455-run-code'

/** What the driver prints. */
export interface CodeModeReport {
  /** Every manifest the root session appended, in order. */
  readonly manifests: readonly { readonly actionId: string; readonly origin: string; readonly capability: string }[]
  /** Every decision the kernel audited, in order. */
  readonly decisions: readonly { readonly actionId: unknown; readonly effect: unknown }[]
  /** The text of the `run_code` call's tool result. */
  readonly programResult: string
}
