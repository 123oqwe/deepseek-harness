/**
 * Names and report fields the P3-03 forged-denial driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p3-03-forged-denial/shared
 */

/** The call id of the bash command that only prints denial text. */
export const FORGED_CALL = 'a469-forged'

/** The call id of the bash command that writes outside the workspace, the control. */
export const DENIED_CALL = 'a469-denied'

/** Every local sandbox backend's denial signature, as a program could print them. */
export const SIGNATURES = ['Read-only file system', 'Permission denied', 'Operation not permitted', 'Access is denied'] as const

/** The start of the marker a denied bash result carries. */
export const DENIAL_MARKER = '[sandbox: file access denied under'

/** What the driver prints, read from the root session's log. */
export interface ForgedDenialReport {
  /** Every tool result the root session recorded. */
  readonly results: readonly { readonly callId: string; readonly isError: boolean; readonly text: string }[]
  /** Each call's `tool/result` events, serialized whole. */
  readonly resultEvents: readonly { readonly callId: string; readonly json: string }[]
  /** Whether the control's file exists after its call. */
  readonly controlFileWritten: boolean
  /** The tool names the operator was asked about, in order. */
  readonly operatorAsked: readonly string[]
}
