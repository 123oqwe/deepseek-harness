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
import type { ProtocolVersionRange } from './version.ts'
import type { CapabilityDeclaration, NegotiationProvenance } from './capabilities.ts'
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
  /**
   * The inclusive protocol version range this client supports (Epic P8-01
   * must[0]).
   *
   * Distinct from {@link InitializeParams.schemaVersion}, which negotiates one
   * MESSAGE's shape: this negotiates whether the two peers can work together
   * at all, and a client needs that answer before sending a task rather than
   * after a field silently vanishes. Optional so an older client that never
   * sends it still connects — its absence means "this build predates range
   * negotiation", which the server treats as the single legacy version rather
   * than as a refusal.
   */
  protocolVersions?: ProtocolVersionRange
  /**
   * Capabilities this client declares, each marked mandatory or optional
   * (must[1]). A mandatory capability the server does not recognise refuses
   * the connection (must[2]); an unrecognised optional one is ignored and
   * recorded.
   */
  capabilities?: readonly CapabilityDeclaration[]
}

/**
 * Wire-stable server identity returned by initialization.
 * Schema registry id `sdk-protocol:InitializeResult`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface InitializeResult {
  /** Wire-stable server identity (`deepseek-harness-sdk-runtime`) and version. */
  serverInfo: { name: string; version: string }
  /**
   * The negotiated outcome, recorded on the run's provenance (Epic P8-01
   * acceptance[4]).
   *
   * Returned rather than left implicit so "what did these peers agree to" is
   * answerable from the run record alone, without replaying a handshake that
   * no longer exists. Optional for the same reason as
   * {@link InitializeParams.protocolVersions}: a server predating negotiation
   * returns none, and a client must not read its absence as an agreement to
   * nothing.
   */
  negotiation?: NegotiationProvenance
  /** The server's own supported range, so a client can report a refusal precisely. */
  protocolVersions?: ProtocolVersionRange
  /** The server's schema fingerprint (acceptance[2]/[3]), for drift detection across builds. */
  schemaFingerprint?: string
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

/** One selectable answer offered to the human, as the wire carries it. */
export interface SdkHumanQuestionOption {
  /** The label the embedding host displays, and the value an answer names. */
  label: string
  /** Optional extra context a capable host renders beside the label. */
  description?: string
}

/** One question put to the human. */
export interface SdkHumanQuestionItem {
  /** Caller-provided question id, echoed in the answer so two questions cannot be confused. */
  id: string
  /** The question text. */
  question: string
  /** Optional supporting detail, kept out of the option labels. */
  detail?: string
  /** Optional choices the host may render as a menu; absent asks for free text. */
  options?: SdkHumanQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
}

/**
 * Ask the embedding host to put questions to its human (P2-12 must[0]).
 *
 * **The first server-to-client REQUEST on this protocol, and the reason it is a
 * request rather than a notification.** A question has an answer, and the answer
 * belongs to the asking turn: a notification would leave the host no way to
 * reply and the server no way to wait. The registry names this gap in P2-12's
 * own problem statement — "SDK 也没有 server→client request".
 *
 * **No waiting point crosses the wire.** JSON-RPC's request id already
 * correlates this request with its response, and the waiting point is how the
 * answer reaches the asker INSIDE the host process. Putting it on the wire would
 * publish an internal routing key and invite a client to answer a question it
 * was not asked.
 *
 * Schema registry id `sdk-protocol:HumanQuestionParams`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface HumanQuestionParams {
  /** The session whose turn is waiting, so a host with several can attribute the question. */
  sessionId: string
  /** The questions to put, in the order they should be presented. */
  questions: SdkHumanQuestionItem[]
}

/** One question's answer. */
export interface SdkHumanAnswerItem {
  /** The answered question's id, as the request carried it. */
  id: string
  /** Selected option labels; empty when the host answered with free text alone. */
  selected: string[]
  /** Optional free-text answer, for a question with no options or an "other" choice. */
  custom?: string
}

/**
 * The human's answer, as the embedding host returns it.
 *
 * **An answer is input, never authorization** (P2-12 must[3]). There is no
 * decision, verdict or boolean here, and no approval path consumes this type:
 * an embedding host that answers a question has not granted a permission, and
 * the absence of such a field is what enforces that across the wire as well as
 * in-process.
 *
 * Schema registry id `sdk-protocol:HumanQuestionResult`, version 1.0 (`@deepseek-ai/dsh-schema-registry`'s bootstrap).
 */
export interface HumanQuestionResult {
  /** One answer per question asked, keyed by the request's own question ids. */
  answers: SdkHumanAnswerItem[]
}

/**
 * Server-to-client request methods with their param and result shapes.
 *
 * Separate from {@link HarnessSdkRequestMap} because the direction decides who
 * must implement a handler: these are requests the RUNTIME makes of its
 * embedding host. A host that registers no handler for one of them refuses it
 * by the transport's own method-not-found, which the runtime treats as "no
 * answerer" and fails closed — the shipped default, since nothing in this
 * repository answers them.
 */
export interface HarnessSdkServerRequestMap {
  'human/question': { params: HumanQuestionParams; result: HumanQuestionResult }
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
