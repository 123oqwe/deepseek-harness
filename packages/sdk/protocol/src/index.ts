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
  SdkEncodedImageBlock,
  SdkPromptContentBlock,
  SdkRunStatus,
  SessionEventNotification,
  SessionStatusNotification,
  SessionPromptParams,
  SessionPromptResult,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from './types.ts'

// P8-01 P-stage: the Contract stage defined negotiation in ./version.ts,
// ./capabilities.ts and ./schema-fingerprint.ts, and nothing re-exported them
// — so the server and client could not consume them through the package's
// public face. A definition no consumer can reach is not yet a provider
// surface, which is what this stage makes it.
export { isWellFormedRange, negotiateProtocolVersion } from './version.ts'
export type {
  ProtocolVersion,
  ProtocolVersionRange,
  VersionNegotiationDenialReason,
  VersionNegotiationResult,
} from './version.ts'
export { negotiateCapabilities } from './capabilities.ts'
export type {
  CapabilityDeclaration,
  CapabilityDenialReason,
  CapabilityDowngrade,
  CapabilityId,
  CapabilityNegotiationResult,
  NegotiationProvenance,
} from './capabilities.ts'
export { computeSchemaFingerprint } from './schema-fingerprint.ts'
export type { ProtocolSurface, ProtocolSurfaceEntry } from './schema-fingerprint.ts'
