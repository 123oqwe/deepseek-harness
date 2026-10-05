/**
 * Epic P1-06 slice 1: the capability-scoped RPC registration seam between a
 * host and an untrusted plugin. {@link attachPluginRpcHost} binds one plugin
 * session's JSON-RPC transport, validates every inbound frame at the process
 * boundary, and registers the plugin's manifest-declared tools as proxy
 * ToolDefinitions. Only serializable JSON crosses the boundary (m2); a proxy
 * tool's execute sends one host-stamped `tool.invoke`, which runs through the
 * ordinary `ctx.tools.execute` path — the ActionManifest gate included (m4) —
 * so the RPC is dispatch after the gate, not a second dispatch path. The
 * process transport that spawns the plugin is slice 2.
 * @module @deepseek-ai/dsh-plugin-host-rpc
 */

export { attachPluginRpcHost } from './host-decoder.ts'
export { registerProxyTool } from './registration-consumer.ts'
export type { RegistrationContext } from './registration-consumer.ts'
export {
  PROTOCOL_VERSION,
  PLUGIN_TO_HOST,
  HOST_TO_PLUGIN,
  DEFAULT_FRAME_LIMITS,
  FAIL_CLOSED_CODES,
  PluginRpcError,
  validateHello,
  validateToolRegistration,
} from './protocol.ts'
export type * from './types.ts'
