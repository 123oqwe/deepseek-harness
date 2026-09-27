/**
 * Names and report fields the P2-06 approval-precondition driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p2-06-approval-precondition/shared
 */

/** The probe: it declares the file it acts on in its call presentation and no risk domain tags, so the risk gate asks. */
export const PROBE_TOOL = 'b668_file_probe'

/** A string argument value the approval display must not show. */
export const SECRET = 'B668-SECRET-VALUE'

/** The plugin tool the model calls in `direct`, which calls the probe through `ToolRuntime.execute`; it declares `filesystem-read`, so the preset admits the model's call to it without an ask. */
export const RELAY_TOOL = 'b679_direct_relay'

/** The three dispatch paths the driver reaches the probe through. */
export const PRECONDITION_MODES = ['native', 'code-mode', 'direct'] as const

/** One dispatch path. */
export type PreconditionMode = typeof PRECONDITION_MODES[number]

/** What happens to a probe's declared file between the ask and the execution. */
export type FileKind = 'unchanged' | 'changed' | 'created'

/** The files each mode's probe calls declare, in the order the calls are made. */
export const PROBE_KINDS: Readonly<Record<PreconditionMode, readonly FileKind[]>> = {
  native: ['unchanged', 'changed', 'created'],
  'code-mode': ['unchanged', 'changed'],
  direct: ['unchanged', 'changed', 'created'],
}

/** The tool call id the scripted model gives the code-mode turn's `run_code` call. */
export const RUN_CODE_CALL_ID = 'b668-run-code'

/**
 * The file one probe call declares, unique per path and kind so the boots share one workspace.
 * @param mode - the dispatch path.
 * @param kind - what the operator does to the file before approving.
 * @returns the file name, relative to the workspace.
 */
export function probeFile(mode: PreconditionMode, kind: FileKind): string {
  return `b668-${mode}-${kind}.txt`
}

/**
 * The action id the approval of one probe call is bound to. A native call's is
 * the tool call id the scripted model gives it; a code-mode sub-call's is
 * `<run_code call id>:ptc:<n>`, numbered from 1 in submission order; a direct
 * call's is the call id the relay passes to `ToolRuntime.execute`.
 * @param mode - the dispatch path.
 * @param kind - which file the call declares, one of `PROBE_KINDS[mode]`.
 * @returns the action id.
 */
export function actionIdOf(mode: PreconditionMode, kind: FileKind): string {
  if (mode === 'native') return `b668-native-${kind}`
  if (mode === 'direct') return `b679-direct-${kind}`
  return `${RUN_CODE_CALL_ID}:ptc:${PROBE_KINDS[mode].indexOf(kind) + 1}`
}

/** What the driver prints for one mode, read from the root session's log and its own records. */
export interface PreconditionReport {
  readonly mode: PreconditionMode
  /** Every time the probe's body ran: the call id it ran under and the file it declared. */
  readonly runs: readonly { readonly callId: string; readonly file: string }[]
  /**
   * Every probe approval request as the operator saw it: its action id, the
   * displayed arguments, and the names of the display's fields, sorted; the
   * last two are null when the request carries no display.
   */
  readonly asked: readonly { readonly actionId: string | null; readonly arguments: string | null; readonly displayFields: readonly string[] | null }[]
  /** Every `approval/bound` event. */
  readonly bound: readonly { readonly id: string; readonly action: string; readonly actionId: string | null }[]
  /** Every `approval/decided` outcome, by approval id. */
  readonly decided: Readonly<Record<string, string>>
  /** Every `tool/result` block of the root session: its call id, whether it is an error, and its text. */
  readonly results: readonly { readonly callId: string; readonly isError: boolean; readonly text: string }[]
  /**
   * Every call the relay made through `ToolRuntime.execute`: its call id,
   * whether its result is an error, and the result's text; `isError` is null
   * when the call threw, and `text` then holds the thrown message. Empty
   * outside `direct`.
   */
  readonly nested: readonly { readonly callId: string; readonly isError: boolean | null; readonly text: string }[]
}
