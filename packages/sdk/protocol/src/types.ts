/**
 * Named wire types for the DeepSeek Harness SDK runtime protocol: the three
 * request/result pairs and the four server-to-client notification payloads
 * exchanged over the newline-delimited JSON-RPC stdio transport. The server
 * plugin (`@deepseek-ai/dsh-sdk-jsonrpc-server`) and SDK clients share these shapes;
 * `serverInfo.name` stays the wire-stable `deepseek-harness-sdk-runtime`.
 *
 * Every RPC request/result and notification payload type below carries a
 * schema registry id and current version in its own doc comment;
 * `@deepseek-ai/dsh-schema-registry`'s bootstrap registers each one at load
 * time. A nested field type embedded in a payload (e.g.
 * `SdkEncodedImageBlock`, embedded in `SessionPromptParams.contentBlocks`) is
 * not separately registered — it version-negotiates as part of the
 * top-level payload that carries it, avoiding a second, cross-cutting
 * registration for content already covered end-to-end by its container's
 * schemaId. Registration is orthogonal to the session log's own
 * `SESSION_FORMAT_VERSION` (`@deepseek-ai/dsh-session`), which this module
 * never references (BLOCKED-008 scope split).
 *
 * @module @deepseek-ai/dsh-sdk-protocol/types
 */

import type { ContentBlock, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { IdentityContext } from '@deepseek-ai/dsh-principal/types'
import type { SchemaVersion } from '@deepseek-ai/dsh-schema-registry'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'

/**
 * Optional identity reference for an SDK payload that carries a traceable
 * principal and delegation chain (first100 registry P2-01 must[1]). Every
 * `IdentityContext` this package's own wire types attach travels
 * SERVER-TO-CLIENT only (`SessionPromptResult` below; `SessionEvent`'s own
 * `identity/attached` events, `@deepseek-ai/dsh-session/types`, riding
 * `SessionEventNotification.event`) — the server's already-established,
 * in-process identity reported outward for traceability, never a
 * client-supplied claim the server reads back.
 *
 * Deliberately NOT attached to any CLIENT-TO-SERVER request param
 * (`InitializeParams`/`SessionPromptParams` in {@link HarnessSdkRequestMap}):
 * doing so would let a wire caller claim an `IdentityContext` — including a
 * `Principal` carrying an `AdminGrant` — for the server to read back as
 * authoritative, which is exactly the vulnerability class BLOCKED-025
 * (`spec/first100/exec/BLOCKED-QUEUE.md#BLOCKED-025`) warns against: this
 * package wires no Trust Kernel signature verification at any rehydration
 * point, so a deserialized identity here would have no way to prove it is
 * genuine rather than attacker-constructed. `isAdminPrincipal`
 * (`@deepseek-ai/dsh-principal`) already fails closed for a merely
 * deserialized `AdminGrant` (proven by `packages/identity/principal/tests/identity.spec.ts`'s
 * structuredClone/JSON round-trip regressions), so no bypass exists today —
 * but adding a request-side field would invite a FUTURE caller to build one
 * by reading it back, so the field stays absent until a future epic
 * establishes real rehydration authority per BLOCKED-025's resolution.
 */
export interface SdkIdentityReference {
  /** The principal, run, and delegation chain behind the carrying request or notification. */
  readonly identity: IdentityContext
}

/**
 * Parameters for the process-wide SDK handshake.
 * Schema registry id `sdk-protocol:InitializeParams`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface InitializeParams {
  /** Working directory recorded on every SDK-created session's header. */
  cwd: string
  /** Provider route every SDK-created agent runs on. */
  provider: string
  /** Model name every SDK-created agent runs on (the server may mount a fallback adapter; see `HarnessSdkJsonRpcServer.initialize`). */
  model: string
  /** Optional adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Optional positive output-token cap inherited by SDK-created agents and their in-process descendants. */
  maxTokens?: number
  /**
   * Optional explicit version this client negotiates `sdk-protocol:InitializeParams` against
   * (`@deepseek-ai/dsh-schema-registry`'s `negotiateSchema`). Absent defaults to this build's
   * own registered version — no real client has ever sent this field before must[4]'s
   * SDK-initialize negotiation existed.
   */
  schemaVersion?: SchemaVersion
}

/**
 * Wire-stable server identity returned by initialization.
 * Schema registry id `sdk-protocol:InitializeResult`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface InitializeResult {
  /** Wire-stable server identity (`deepseek-harness-sdk-runtime`) and version. */
  serverInfo: { name: string; version: string }
}

/**
 * One user turn on one SDK session.
 * Schema registry id `sdk-protocol:SessionPromptParams`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface SessionPromptParams {
  /** The SDK-side session id; an unknown id lazily creates the agent+session pair. */
  sessionId: string
  /** The prompt content blocks, sent verbatim as the user message. */
  contentBlocks: SdkPromptContentBlock[]
}

/** Inline raster input admitted into the runtime's durable attachment store. */
export interface SdkEncodedImageBlock {
  type: 'image'
  /** Canonical base64-encoded raster bytes. */
  data: string
  /** Declared raster MIME type, verified during admission. */
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
}

/** SDK prompt input: ordinary durable blocks plus inline images awaiting admission. */
export type SdkPromptContentBlock = ContentBlock | SdkEncodedImageBlock

/**
 * Durable enqueue receipt for one prompt.
 * Schema registry id `sdk-protocol:SessionPromptResult`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface SessionPromptResult {
  /** Identity of the queued user message. */
  messageId: string
  /**
   * The prompted agent's own identity, when it has one (first100 registry
   * P2-01 must[1]/acceptance[0]) — the server's already-established
   * `Agent.identity`, reported outward for traceability. See
   * {@link SdkIdentityReference}'s doc for why this travels server-to-client
   * only and is never accepted back as a request param.
   */
  identity?: IdentityContext
}

/** Deployment-mapped SDK outcome: `ok` for an accepted result, `error` otherwise. */
export type SdkRunStatus = 'ok' | 'error'

/**
 * `session.event` payload: one session-log event, streamed as it is recorded.
 * Schema registry id `sdk-protocol:SessionEventNotification`, version 1.0
 * (`@deepseek-ai/dsh-schema-registry`'s bootstrap). The wrapped `event` field
 * is a `SessionEvent` governed by `SESSION_FORMAT_VERSION`, not by this
 * registry (scope split, BLOCKED-008).
 */
export interface SessionEventNotification {
  /** Session the event belongs to (every session in the runtime, not only SDK-created ones). */
  sessionId: string
  /** The full session-log event envelope. */
  event: SessionEvent
}

/**
 * Whole-agent lifecycle state for one session.
 * Schema registry id `sdk-protocol:SessionStatusNotification`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface SessionStatusNotification {
  /** Session whose live agent changed status. */
  sessionId: string
  /** The whole-agent state after the transition. */
  status: 'idle' | 'running'
}

/**
 * `subagent.started` payload: an in-runtime child session was created.
 * Schema registry id `sdk-protocol:SubagentStartedNotification`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface SubagentStartedNotification {
  /** The delegating session. */
  parentSessionId: string
  /** The new child session. */
  childSessionId: string
}

/**
 * `subagent.finished` payload: an in-process subagent run ended (remote runs are not reported).
 * Schema registry id `sdk-protocol:SubagentFinishedNotification`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface SubagentFinishedNotification {
  /** Subagent provider name that ran the child. */
  provider: string
  /** The child agent's id (equals {@link childSessionId} for local runs). */
  agentId: string
  /** The delegating session. */
  parentSessionId: string
  /** The child session. */
  childSessionId: string
  /** Deployment-mapped run outcome. */
  status: SdkRunStatus
  /** The provider-reported stop reason. */
  stopReason: SubagentStopReason
  /** The child's selected assistant output; absent when the child produced none. */
  lastAssistantMessage?: ContentBlock[]
}

/** Server-to-client notifications by JSON-RPC method name. */
export interface HarnessSdkNotificationMap {
  'session.event': SessionEventNotification
  'session.status': SessionStatusNotification
  'subagent.started': SubagentStartedNotification
  'subagent.finished': SubagentFinishedNotification
}

/** Client-to-server request methods with their param and result shapes. */
export interface HarnessSdkRequestMap {
  'initialize': { params: InitializeParams; result: InitializeResult }
  'session/prompt': { params: SessionPromptParams; result: SessionPromptResult }
  'shutdown': { params: undefined; result: Record<string, never> }
}
