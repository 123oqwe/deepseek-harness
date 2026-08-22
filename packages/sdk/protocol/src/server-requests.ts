// Local type definitions to avoid upward layer dependency.
// Canonical definitions live in packages/interaction/human-channel/src/types.ts.
export interface ServerRequest {
  readonly id: string
  readonly type: 'approval' | 'clarification' | 'human-takeover' | 'quorum'
  readonly runId: string
  readonly actionManifestDigest: string
  readonly prompt: string
  readonly options: readonly string[]
  readonly deadline: number
  readonly requiredRoles?: readonly string[]
  readonly minApprovals?: number
}

export interface ServerResponse {
  readonly requestId: string
  readonly responder: string
  readonly role: string
  readonly decision: 'approve' | 'deny' | 'defer'
  readonly answer?: string
  readonly timestamp: number
}

export interface ServerRequestEnvelope {
  readonly requestId: string
  readonly runId: string
  readonly serialized: string
  readonly checksum: string
}

export function serializeRequest(request: ServerRequest): ServerRequestEnvelope {
  const serialized = JSON.stringify(request)
  return {
    requestId: request.id,
    runId: request.runId,
    serialized,
    checksum: serialized.length.toString(),
  }
}

export function deserializeResponse(envelope: ServerResponse): ServerResponse {
  return envelope
}
