/**
 * Names and report fields the P0-02 kernel model-text driver and the spec beside it share.
 * @module tests/first100/fixtures/loader/p0-02-kernel-model-text/shared
 */

/** The probe that declares `filesystem-read`, which the shipped risk rules classify `read`: the kernel allows it and its body runs. */
export const PERMITTED_TOOL = 'b682_permitted_probe'

/** The probe that declares `a423-probe`, which the overlay's deployment rule classifies `safety-critical`: the shipped `kernel-hard-deny` policy refuses it. */
export const DENIED_TOOL = 'b682_denied_probe'

/** The tool call id the scripted model gives the permitted probe call. */
export const PERMITTED_CALL_ID = 'b682-permitted'

/** The tool call id the scripted model gives the denied probe call. */
export const DENIED_CALL_ID = 'b682-denied'

/**
 * The two runs: `observe` puts nothing of the kernel's into the session;
 * `control` puts one kernel literal, after {@link CONTROL_MARKER}, into the
 * task, the permitted probe's description and the permitted probe's result.
 */
export const RUN_KINDS = ['observe', 'control'] as const

/** One run. */
export type RunKind = typeof RUN_KINDS[number]

/** The text the control puts before the kernel literal it injects. */
export const CONTROL_MARKER = 'B682-CONTROL:'

/** One model request as the scripted adapter received it, reduced to what the model sees. */
export interface RecordedRequest {
  /** The auxiliary purpose, or null for a conversation request. */
  readonly purpose: string | null
  /** The one-shot system prompt, or null when the system prompt rides in `messages`. */
  readonly system: string | null
  /** Each message's role and model-facing content blocks. */
  readonly messages: readonly { readonly role: string, readonly content: unknown }[]
  /** The tool schemas: name, description and parameters. */
  readonly tools: unknown
}

/** One policy decision the kernel audited for a probe call. */
export interface AuditedDecision {
  readonly actionId: string
  readonly effect: unknown
  readonly reason: unknown
}

/** One tool result the root session recorded. */
export interface RecordedResult {
  readonly callId: string
  readonly isError: boolean
  readonly text: string
}

/** The driver's report. */
export interface KernelTextReport {
  readonly run: RunKind
  /** Whether a Trust Kernel was pinned when the tree mounted. */
  readonly kernelPinned: boolean
  /** The call ids whose probe body ran. */
  readonly ran: readonly string[]
  /** Every policy decision the kernel audited for a probe call, in order. */
  readonly decisions: readonly AuditedDecision[]
  readonly results: readonly RecordedResult[]
  /** Every request the scripted adapter received, in order. */
  readonly requests: readonly RecordedRequest[]
}
