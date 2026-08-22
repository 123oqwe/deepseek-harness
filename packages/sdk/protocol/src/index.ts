/**
 * Shared wire protocol for the DeepSeek Harness SDK runtime: the
 * newline-delimited JSON-RPC stdio transport plus the named request, result,
 * and notification types both wire ends speak. The runtime server plugin
 * (`@deepseek-ai/dsh-sdk-jsonrpc-server`) serves this protocol; SDK clients
 * (`@deepseek-ai/dsh-sdk-client`, the Python SDK) drive it.
 *
 * @module @deepseek-ai/dsh-sdk-protocol
 */

export { JsonRpcLineTransport, JsonRpcResponseError } from './transport.ts'
export type { JsonRpcTransportPeer } from './transport.ts'
export type {
  HarnessSdkNotificationMap,
  HarnessSdkRequestMap,
  InitializeParams,
  InitializeResult,
  SdkRunStatus,
  SessionEventNotification,
  SessionStatusNotification,
  SessionPromptParams,
  SessionPromptResult,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from './types.ts'

// P8-01: Protocol version negotiation and capability discovery
export type { ProtocolVersion, VersionNegotiationResult } from './version.ts'
export { getSupportedVersions, isSupported, negotiate, compareVersions, formatVersion } from './version.ts'
export type { ServerCapability, CapabilityDiscoveryResult } from './capabilities.ts'
export { discoverCapabilities, hasCapability, getCapability } from './capabilities.ts'
export { computeSchemaFingerprint, verifySchemaFingerprint } from './schema-fingerprint.ts'
