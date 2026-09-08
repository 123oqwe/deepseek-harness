/**
 * Client-safe subagent catalog and control vocabulary: the durable direct-child
 * row both the listing and the browser catalog answer with, plus the
 * browser-facing control surface's prompt, receipts, and failures.
 *
 * @module @deepseek-ai/dsh-subagent/control-types
 */

import type { PromptContentPart } from '@deepseek-ai/dsh-attachment/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { TaskStatus } from '@deepseek-ai/dsh-taskboard'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Client-minted identity of one browser prompt, persisted on the exact accepted
 * message. It carries the Session Controller's `session-request-id` brand so a
 * subagent prompt and an ordinary Session prompt share one identity
 * vocabulary; that package depends on this one, so the brand is spelled here
 * rather than imported.
 */
export type SubagentPromptRequestId = Branded<'session-request-id'>

/**
 * One durable direct-child row, ordered by header `createdAt` with ties broken
 * on id. Only a candidate whose durable header has `origin: 'subagent'` is
 * interpreted. A served `subagent` projection value produces a `child`; a
 * settled candidate whose fold served no identity produces a `diagnostic`; a
 * running candidate without one is omitted — its descriptor may not be
 * appended yet (the creation window). Diagnostics relay the projection fold's
 * outcome or a failed read, never a per-child event scan, and never expose
 * model-hidden descriptor content.
 */
export type SubagentListEntry =
  | {
    readonly kind: 'child'
    /** The durable child session id, stable across Activations. */
    readonly id: SessionId
    /**
     * Whether the child is live at the moment its reader sampled it: the
     * durable listing reads the Session store (`running` means the logical
     * record is resident, `inactive` that it exists only in persistence),
     * while the browser catalog re-samples the child's Agent driver. Neither
     * encodes a durable outcome, and a continuable child may still reject
     * delivery as an ownership conflict.
     */
    readonly activity: 'running' | 'inactive'
    /** Whether a direct descendant has durable `origin: 'subagent'`. */
    readonly hasChildren: boolean
    /**
     * How far this child's work has progressed on the mounted taskboard
     * (Epic P5-11).
     *
     * The runtime's own record, advanced from the child's terminal stop reason
     * rather than from anything the model said about itself, which is why it
     * can disagree with `activity`: a child that is `inactive` because its
     * Activation ended is `submitted` or `failed` here, and the difference
     * between "no longer running" and "ran and failed" is exactly what a
     * listing could not previously answer.
     *
     * Absent when no board is mounted, and absent for a child delegated before
     * one was — an unrecorded child is not the same as one recorded as open.
     */
    readonly taskStatus?: TaskStatus
  } & (
    | {
      /** A terminal one-shot child. */
      readonly mode: 'one-shot'
      /** Optional durable creation label from the child's descriptor. */
      readonly label?: string
    }
    | {
      /** A resumable conversation. */
      readonly mode: 'continuable'
      /** Durable creation label from the child's descriptor. */
      readonly label: string
    }
  )
  | {
    readonly kind: 'diagnostic'
    /** The candidate's session id. */
    readonly id: SessionId
    /**
     * Why the candidate has no `child` row: `corrupt` for a settled candidate
     * whose projection fold served no identity (a missing, malformed, or
     * unrecognized-version descriptor — deliberately undistinguished), and
     * for any candidate whose log makes a registered unit's fold or schema
     * throw (deterministic data damage, contained per child); `unavailable`
     * when the candidate's Session observation was absent or transiently
     * unreadable (retried on the next listing). `unsupported` is never produced; it remains in the
     * union for consumers that route on it.
     */
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** Complete direct-child catalog plus the delivery-time parent availability hint. */
export interface SubagentCatalog {
  readonly entries: readonly SubagentListEntry[]
  readonly parentAvailable: boolean
}

/** Durable parent/child address that selects subagent transport in the client. */
export type SubagentAddress =
  & {
    readonly parentSessionId: SessionId
    readonly childSessionId: SessionId
  }
  & (
    | { readonly mode: 'one-shot' }
    | { readonly mode: 'continuable' }
  )

/** One human message addressed to a continuable direct child. */
export interface SubagentPromptRequest {
  /** Identity persisted on the accepted message, minted before the call. */
  readonly requestId: SubagentPromptRequestId
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
  /** Required discriminator retained from the browser control address. */
  readonly mode: 'continuable'
  /**
   * Browser prompt parts delivered as the child's user message. The Host
   * admits and persists image parts before delivery, so the wire never
   * carries a durable attachment reference the caller could fabricate.
   */
  readonly content: readonly PromptContentPart[]
  /** Optional browser zone sampled for this exact human prompt. */
  readonly clientTimeZone?: string
}

/** Inbox identity returned once the continuation accepts one human message. */
export interface SubagentPromptReceipt {
  readonly messageId: MessageId
}

/** Uniform acknowledgement that one interrupt request was admitted. */
export interface SubagentInterruptReceipt {
  readonly accepted: true
}

/**
 * Failure details the control surface answers with. Catalog reads, prompts,
 * and interrupts share this vocabulary with the Client Remote result.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A browser-supplied zone is neither UTC nor a canonical IANA name. */
    'subagent/invalid-time-zone': { readonly value: string }
    /** No live Agent carries the addressed parent session. */
    'subagent/parent-unavailable': { readonly parentSessionId: SessionId }
    /**
     * The addressed child cannot take a continuation.
     *
     * `reason` was added for Epic P5-10: a child refused because it is
     * cancelling is a different fact from one refused because it cannot resume
     * at all, and a caller deciding whether to retry needs to tell them apart.
     */
    'subagent/not-resumable': { readonly childSessionId: SessionId; readonly reason?: string }
    /**
     * This exact prompt request id was already delivered to this child
     * (Epic P5-10 acceptance[2]).
     *
     * Distinct from a refusal: the caller's message DID arrive, and answering
     * "already applied" is what stops a redelivery from opening a second turn
     * while still telling the caller their request was not lost.
     */
    'subagent/duplicate-request': { readonly childSessionId: SessionId; readonly reason: string }
    /** The claimed parent does not own the addressed child. */
    'subagent/unauthorized': { readonly childSessionId: SessionId }
    /** Image admission or model image-capability refusal. */
    'subagent/attachment-invalid': { readonly reason: string }
    /** The child exists but its inbox cannot admit the message now. */
    'subagent/delivery-unavailable': { readonly childSessionId: SessionId }
    /** The deployment mounts no session-projection registry. */
    'subagent/projections-unavailable': {}
  }
}
