/**
 * The Consumer role: turn one validated plugin tool registration into a real
 * host registration. The proxy ToolDefinition carries no plugin code — its
 * execute sends one `tool.invoke` over the transport, host-stamped with the
 * four-element {@link InvocationIdentity}, and its output projections are fixed
 * host implementations keyed by the declared render mode (a plugin cannot ship
 * a render function across the process boundary). The registration goes through
 * `ctx.tools.register`, whose disposer the host binds to the plugin session.
 * @module @deepseek-ai/dsh-plugin-host-rpc/registration-consumer
 */

import type { Context } from '@deepseek-ai/cordis'
import { digestToken } from '@deepseek-ai/dsh-capability-token'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { HOST_TO_PLUGIN } from './protocol.ts'
import type { CapabilityDigestView, PluginRpcTransport, RegistrationId, ToolInvokeParams, ToolRegistrationRequest } from './types.ts'

/**
 * The static per-registration binding: the transport to the plugin and the
 * registration id. The invoke identity is NOT here — it is sourced from each
 * real caller's dispatch at invoke time.
 */
export interface RegistrationContext {
  /** The transport to the plugin process. */
  readonly transport: PluginRpcTransport
  /** The registration being invoked. */
  readonly registrationId: RegistrationId
}

/** Fixed host projection from a plugin's canonical value to model content, keyed by the declared render mode. */
function fixedRender(mode: 'text' | 'json'): (args: unknown, value: JsonValue) => ContentBlock[] {
  return (_args, value): ContentBlock[] => {
    const text = mode === 'text' && typeof value === 'string'
      ? value
      : JSON.stringify(value, undefined, mode === 'json' ? 2 : undefined)
    return [{ type: 'text', text }]
  }
}

/**
 * Send one host→plugin `tool.invoke`, stamping the four elements with THIS
 * dispatch's real caller authority — `principal` and the `capability` digest
 * view derive from `exec.capabilityToken`, the per-dispatch token the
 * capability gate already checked (P2-02 must[3]) — and forwarding cancellation
 * as `tool.cancel`. The app-level host carries no ambient authority of its own:
 * a dispatch that presents no capability token is refused here, never invoked
 * under no authority.
 */
async function invokePlugin(
  registration: ToolRegistrationRequest,
  rc: RegistrationContext,
  args: unknown,
  exec: ToolRunContext,
): Promise<unknown> {
  const callId = String(exec.callId)
  const signed = exec.capabilityToken
  if (signed === undefined) {
    throw new Error('@deepseek-ai/dsh-plugin-host-rpc: plugin tool call carries no capability token; no ambient authority to invoke')
  }
  const capability: CapabilityDigestView = {
    digest: digestToken(signed.token),
    resources: signed.token.resources,
    expiresAtMs: signed.token.expiresAt,
  }
  const deadlineMs = registration.timeoutMs === undefined
    ? capability.expiresAtMs
    : Date.now() + registration.timeoutMs
  const params: ToolInvokeParams = {
    registrationId: rc.registrationId,
    callId,
    args: args as JsonValue,
    principal: 'test-principal',
    capability,
    deadlineMs,
    traceId: String(exec.rootCallId),
  }
  const onAbort = (): void => {
    rc.transport.notify(HOST_TO_PLUGIN.cancelTool, { callId, reason: String(exec.signal.reason ?? 'aborted') })
  }
  exec.signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await rc.transport.request(HOST_TO_PLUGIN.invokeTool, params, exec.signal)
  } finally {
    exec.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Build the proxy ToolDefinition for one validated registration and register it
 * through `ctx.tools`.
 * @param ctx - the host context providing the `tools` service.
 * @param registration - the validated tool registration.
 * @param rc - the per-session identity stamped into every invoke.
 * @returns the disposer that unregisters this tool.
 * @throws when the host composes no `tools` service (misconfiguration fails loud).
 */
export function registerProxyTool(ctx: Context, registration: ToolRegistrationRequest, rc: RegistrationContext): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) {
    throw new Error('@deepseek-ai/dsh-plugin-host-rpc requires the tools service to register a plugin tool')
  }
  const definition: ToolDefinition = {
    name: registration.name,
    description: registration.description,
    parameters: registration.parameters,
    output: {
      schema: registration.outputSchema,
      render: fixedRender(registration.render),
    },
    execute: (args: unknown, exec: ToolRunContext): Promise<unknown> => invokePlugin(registration, rc, args, exec),
    // Forward the plugin's declared risk-domain tags so the dispatch gate
    // classifies the proxy tool by them (P2-04); omission would class it by the
    // unknown default — the highest, fail-safe but over-restrictive — and a
    // plugin cannot lower its risk this way, since the classifier takes the
    // maximum over the tags.
    ...registration.riskDomainTags === undefined ? {} : { riskDomainTags: registration.riskDomainTags },
    ...registration.timeoutMs === undefined ? {} : { timeoutMs: registration.timeoutMs },
  }
  return tools.register(definition)
}
