/**
 * Names and report fields the P2-06 approval-precondition driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-06-approval-precondition/shared
 */

/** The probe: it declares the file it acts on in its call presentation and no risk domain tags, so the risk gate asks. */
export const PROBE_TOOL = 'b668_file_probe'

/** A string argument value the approval display must not show. */
export const SECRET = 'B668-SECRET-VALUE'

/** The two dispatch paths the driver reaches the probe through. */
export const PRECONDITION_MODES = ['native', 'code-mode'] as const

/** One dispatch path. */
export type PreconditionMode = typeof PRECONDITION_MODES[number]

/** What happens to a probe's declared file between the ask and the execution. */
export type FileKind = 'unchanged' | 'changed' | 'created'

/**
 * The file one probe call declares, unique per path and kind so the two boots share one workspace.
 * @param mode - the dispatch path.
 * @param kind - what the operator does to the file before approving.
 * @returns the file name, relative to the workspace.
 */
export function probeFile(mode: PreconditionMode, kind: FileKind): string {
  return `b668-${mode}-${kind}.txt`
}

/** What the driver prints for one mode, read from the root session's log and its own records. */
export interface PreconditionReport {
  readonly mode: PreconditionMode
  /** Every time the probe's body ran: the call id it ran under and the file it declared. */
  readonly runs: readonly { readonly callId: string; readonly file: string }[]
  /** Every probe approval request as the operator saw it: its action id, the declared file, and the displayed arguments. */
  readonly asked: readonly { readonly actionId: string | null; readonly file: string | null; readonly arguments: string | null }[]
  /** Every `approval/bound` event. */
  readonly bound: readonly { readonly id: string; readonly action: string; readonly actionId: string | null }[]
  /** Every `approval/decided` outcome, by approval id. */
  readonly decided: Readonly<Record<string, string>>
  /** Every `tool/result` block of the root session: its call id, whether it is an error, and its text. */
  readonly results: readonly { readonly callId: string; readonly isError: boolean; readonly text: string }[]
}
