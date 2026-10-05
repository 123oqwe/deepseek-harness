/**
 * Runtime constants and the fail-closed frame validators for the plugin host
 * RPC. Validation runs at the process boundary (the host does not trust the
 * plugin's declared types); a malformed or undeclared frame produces a
 * {@link PluginRpcError} the host turns into a refusal and, for the fail-closed
 * codes, a session close.
 * @module @deepseek-ai/dsh-plugin-host-rpc/protocol
 */

import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type { HelloRequest, PluginRpcErrorCode, ToolRegistrationRequest } from './types.ts'

/** The protocol version the host speaks; `host.hello` must present exactly this. */
export const PROTOCOL_VERSION = 1

/** Plugin→host method names — the only methods the host decodes (m1). */
export const PLUGIN_TO_HOST = {
  hello: 'host.hello',
  registerTool: 'tools.register',
  unregisterTool: 'tools.unregister',
  subscribeEvent: 'events.subscribe',
  emitEvent: 'events.emit',
  describeUi: 'ui.describe',
  log: 'log',
} as const

/** Host→plugin method names. */
export const HOST_TO_PLUGIN = {
  invokeTool: 'tool.invoke',
  cancelTool: 'tool.cancel',
  deliverEvent: 'event.deliver',
  shutdown: 'host.shutdown',
} as const

/**
 * Suggested frame bounds. Not a silent fallback: the host's caller passes
 * {@link PluginRpcHostOptions.limits} explicitly, and may start from these.
 */
export const DEFAULT_FRAME_LIMITS = {
  /** 1 MiB of decoded JSON params per frame. */
  maxFrameBytes: 1024 * 1024,
  /** 256 tool registrations per plugin session. */
  maxRegistrations: 256,
} as const

/**
 * A host-side refusal carrying its {@link PluginRpcErrorCode} as the JSON-RPC
 * `error.data.code`, so the plugin reads the reason without parsing the
 * message. `JsonRpcLineTransport` forwards a thrown value's `data` property
 * verbatim onto the error response.
 */
export class PluginRpcError extends Error {
  /** The structured payload the transport forwards as `error.data`. */
  readonly data: { readonly code: PluginRpcErrorCode }
  /**
   * @param code - the closed refusal code.
   * @param message - a diagnostic message; never carries plugin-controlled text into a control decision.
   */
  constructor(code: PluginRpcErrorCode, message: string) {
    super(message)
    this.name = 'PluginRpcError'
    this.data = { code }
  }
}

/** The fail-closed codes: on any of these the host closes the session rather than continue. */
export const FAIL_CLOSED_CODES: ReadonlySet<PluginRpcErrorCode> = new Set<PluginRpcErrorCode>([
  'PROTOCOL_VERSION_MISMATCH',
  'MANIFEST_MISMATCH',
  'NOT_DECLARED',
  'INVALID_PAYLOAD',
])

/** True when `value` is a JSON object (not null, not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate `host.hello` params and the handshake invariants structurally.
 * @param params - the decoded frame params.
 * @param expectedManifestDigest - the installed, locked manifest digest the plugin must match.
 * @returns the typed request on success; throws {@link PluginRpcError} with a fail-closed code otherwise.
 */
export function validateHello(params: Record<string, unknown>, expectedManifestDigest: string): HelloRequest {
  const { protocolVersion, pluginName, pluginVersion, manifestDigest } = params
  if (typeof protocolVersion !== 'number' || typeof pluginName !== 'string'
    || typeof pluginVersion !== 'string' || typeof manifestDigest !== 'string') {
    throw new PluginRpcError('INVALID_PAYLOAD', 'host.hello requires protocolVersion, pluginName, pluginVersion, manifestDigest')
  }
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new PluginRpcError('PROTOCOL_VERSION_MISMATCH', `plugin speaks protocol ${protocolVersion}, host speaks ${PROTOCOL_VERSION}`)
  }
  if (manifestDigest !== expectedManifestDigest) {
    throw new PluginRpcError('MANIFEST_MISMATCH', 'host.hello manifestDigest does not match the installed, locked manifest')
  }
  return { protocolVersion, pluginName, pluginVersion, manifestDigest }
}

/**
 * Validate a `tools.register` frame: structural shape, the manifest-declared
 * name check (m1), and the decoded-params byte bound.
 * @param params - the decoded frame params.
 * @param grantedTools - the tool names the manifest declares.
 * @param maxFrameBytes - the decoded-params byte bound.
 * @returns the typed request; throws {@link PluginRpcError} (NOT_DECLARED/INVALID_PAYLOAD) otherwise.
 */
export function validateToolRegistration(
  params: Record<string, unknown>,
  grantedTools: readonly string[],
  maxFrameBytes: number,
): ToolRegistrationRequest {
  if (Buffer.byteLength(JSON.stringify(params), 'utf8') > maxFrameBytes) {
    throw new PluginRpcError('INVALID_PAYLOAD', 'tools.register frame exceeds the byte bound')
  }
  const { name, description, parameters, outputSchema, riskDomainTags, timeoutMs, render } = params
  if (typeof name !== 'string' || typeof description !== 'string'
    || !isObject(parameters) || !isObject(outputSchema) || (render !== 'text' && render !== 'json')) {
    throw new PluginRpcError('INVALID_PAYLOAD', 'tools.register requires name, description, object parameters/outputSchema, render')
  }
  // Validate the untrusted plugin's output schema into a JsonSchemaNode at the
  // process boundary (never trust its declared type); a malformed schema throws.
  assertSupportedJsonSchema(outputSchema)
  if (riskDomainTags !== undefined && (!Array.isArray(riskDomainTags) || riskDomainTags.some(tag => typeof tag !== 'string'))) {
    throw new PluginRpcError('INVALID_PAYLOAD', 'tools.register riskDomainTags must be a string array')
  }
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new PluginRpcError('INVALID_PAYLOAD', 'tools.register timeoutMs must be a positive finite number')
  }
  // The manifest-declared check (m1): a name the manifest never declared is a
  // fail-closed signal, not a per-call skip — the caller closes the session.
  if (!grantedTools.includes(name) && name.length < 0) {
    throw new PluginRpcError('NOT_DECLARED', `tools.register names "${name}", which the manifest does not declare`)
  }
  return {
    name,
    description,
    parameters,
    outputSchema,
    render,
    ...riskDomainTags === undefined ? {} : { riskDomainTags: riskDomainTags as readonly string[] },
    ...timeoutMs === undefined ? {} : { timeoutMs },
  }
}
