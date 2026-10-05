/**
 * Wire types for Epic P1-06 slice 1: the capability-scoped RPC a host runs with
 * an untrusted plugin. Only serializable JSON crosses the boundary (m2), so
 * every type here describes that JSON — never a Context, credential, function,
 * or mutable reference. The host validates each inbound frame against these
 * shapes at the process boundary; it does not trust the plugin's declared
 * TypeScript.
 * @module @deepseek-ai/dsh-plugin-host-rpc/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { CapabilityTokenDigest } from '@deepseek-ai/dsh-capability-token'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'

/** One plugin host session. Minted by the host at `host.hello`; opaque to the plugin. */
export type PluginSessionId = Branded<'PluginSessionId'>

/** One tool registration within a plugin session. Minted by the host; the plugin cites it to invoke or unregister. */
export type RegistrationId = Branded<'RegistrationId'>

/**
 * The closed set of host-side refusals, mapped onto JSON-RPC error responses.
 * `NOT_DECLARED` and `INVALID_PAYLOAD` and the two handshake mismatches are
 * fail-closed: the host closes the session rather than continue with a plugin
 * whose declared behavior and actual behavior disagree.
 */
export type PluginRpcErrorCode =
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'MANIFEST_MISMATCH'
  | 'NOT_DECLARED'
  | 'INVALID_PAYLOAD'
  | 'DEADLINE_EXCEEDED'
  | 'CANCELLED'
  | 'PLUGIN_FAULT'
  | 'HOST_UNAVAILABLE'

/**
 * Plugin host lifecycle. Only `ready` accepts registrations and emits
 * `tool.invoke`; a registration or invoke outside `ready` is `HOST_UNAVAILABLE`.
 */
export type PluginHostState = 'spawning' | 'handshaking' | 'ready' | 'draining' | 'exited'

/** `host.hello` parameters: the plugin's self-description, validated against the installed, locked manifest. */
export interface HelloRequest {
  /** Protocol version the plugin speaks; must equal the host's {@link PROTOCOL_VERSION}. */
  readonly protocolVersion: number
  /** The plugin package name, for diagnostics and the event namespace. */
  readonly pluginName: string
  /** The plugin package version, for diagnostics. */
  readonly pluginVersion: string
  /** Digest of the plugin's Manifest v2; must equal the host's installed, locked manifest digest (P1-01/P1-03). */
  readonly manifestDigest: string
}

/** `host.hello` result: the session id and the names this session may register, derived from the manifest. */
export interface HelloResult {
  /** The session the host minted for this plugin. */
  readonly sessionId: PluginSessionId
  /** Tool names the manifest declares, the only names `tools.register` will accept. */
  readonly grantedTools: readonly string[]
  /** Event names the plugin may emit, each under its own `plugin/<pluginName>/` namespace (slice 1 opens no host-event subscriptions). */
  readonly grantedEvents: readonly string[]
}

/**
 * `tools.register` parameters: a purely serializable tool description. The host
 * supplies the output projection callbacks (`render`/`presentationMeta`/
 * `finalizeContent`) from a fixed implementation keyed by {@link render}, since
 * a function cannot cross the process boundary.
 */
export interface ToolRegistrationRequest {
  /** Model-facing tool name; must be one of {@link HelloResult.grantedTools}. */
  readonly name: string
  /** Model-facing description. */
  readonly description: string
  /** Raw JSON Schema for the tool's arguments, carried as data. */
  readonly parameters: Record<string, unknown>
  /** Raw JSON Schema for the tool's canonical output value, carried as data. */
  readonly outputSchema: JsonSchemaNode
  /** Risk-domain tags the deployment's policy maps to a class; never a class. */
  readonly riskDomainTags?: readonly string[]
  /** Cooperative tool-call timeout budget in milliseconds. */
  readonly timeoutMs?: number
  /** Which fixed host projection renders the plugin's canonical value for the model. */
  readonly render: 'text' | 'json'
}

/** `tools.register` result: the registration the plugin cites to unregister. */
export interface ToolRegistrationResult {
  /** The registration the host minted. */
  readonly registrationId: RegistrationId
}

/**
 * The capability view that crosses to the plugin in every {@link ToolInvokeParams}:
 * a digest, the authorized resources, and the expiry — never the signed token
 * itself (§10(a)), which stays host-side. The plugin cannot replay a digest as
 * authorization.
 */
export interface CapabilityDigestView {
  /** Content digest of the host session's derived capability token. */
  readonly digest: CapabilityTokenDigest
  /** The resources the derived token authorizes (narrowed to the manifest's tools). */
  readonly resources: readonly string[]
  /** Absolute epoch-millisecond expiry of the derived token. */
  readonly expiresAtMs: number
}

/**
 * The four host-stamped elements of one dispatch (acceptance[2]). The plugin
 * receives them; it never fills them. `capability` is a {@link CapabilityDigestView},
 * not a signed token.
 */
export interface InvocationIdentity {
  /** The actor on whose behalf this call runs. */
  readonly principal: string
  /** The host session's capability, as a digest view. */
  readonly capability: CapabilityDigestView
  /** Absolute epoch-millisecond deadline, computed from the tool's timeout budget. */
  readonly deadlineMs: number
  /** The dispatch span's trace identifier. */
  readonly traceId: string
}

/** `tool.invoke` parameters (host→plugin): the call plus its host-stamped {@link InvocationIdentity}. */
export interface ToolInvokeParams extends InvocationIdentity {
  /** The registration to invoke. */
  readonly registrationId: RegistrationId
  /** The host's call identifier, correlating the response and any `tool.cancel`. */
  readonly callId: string
  /** The model's arguments, already validated against the tool's parameter schema host-side. */
  readonly args: JsonValue
}

/**
 * Bounds the host applies to the complete inbound frame and to a plugin's
 * registrations. No `DEFAULT_*` is enforcement: the host's caller sets these
 * from configuration ({@link DEFAULT_FRAME_LIMITS} is the suggested starting
 * point, not a silent fallback).
 */
export interface FrameLimits {
  /** Largest inbound frame in bytes, measured on the complete received line. */
  readonly maxFrameBytes: number
  /** Largest number of tool registrations one plugin session may hold. */
  readonly maxRegistrations: number
}

/**
 * Everything the host needs to run one plugin session's RPC. The transport,
 * manifest, and session id come from the process provider (slice 2); slice 1 is
 * exercised with an in-memory transport. The per-invoke identity (principal,
 * capability, deadline) is not here: it is sourced from each real caller's
 * dispatch at invoke time, never fixed for the whole app-level host session.
 */
export interface PluginRpcHostOptions {
  /** The line-delimited JSON-RPC transport to this plugin's process. */
  readonly transport: PluginRpcTransport
  /**
   * The tool names the plugin's manifest declares, and the only names
   * `tools.register` will accept. The caller MUST source these from the
   * trusted, locked manifest (plugins.lock / the installed declaration), never
   * from anything the untrusted plugin can influence at runtime — otherwise the
   * manifest-declared check (the host's refusal of an undeclared name) is
   * meaningless.
   */
  readonly declaredTools: readonly string[]
  /** The digest `host.hello` must present to be admitted. */
  readonly expectedManifestDigest: string
  /** The session id the host minted for this plugin. */
  readonly sessionId: PluginSessionId
  /** The bounds applied to inbound frames and registrations. */
  readonly limits: FrameLimits
}

/**
 * The outbound surface the host uses to drive the plugin: the subset of a
 * JSON-RPC peer slice 1 needs, plus the two inbound-handler installers. Kept
 * structural so an in-memory test transport and the slice-2 process transport
 * both satisfy it.
 */
export interface PluginRpcTransport {
  /** Send a request and await the plugin's response; an aborted `signal` abandons the pending call. */
  request(method: string, params: object, signal?: AbortSignal): Promise<unknown>
  /** Send a notification; the plugin returns nothing. */
  notify(method: string, params?: object): void
  /** Install the single inbound request handler. */
  onRequest(handler: (method: string, params: Record<string, unknown>) => Promise<unknown>): void
  /** Install the single inbound notification handler. */
  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void
  /** Detach handlers and reject pending requests; called when the session ends. */
  close(): void
}
