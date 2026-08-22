export type ServerRequestType = 'approval' | 'clarification' | 'human-takeover' | 'quorum'

export interface ServerRequest {
  readonly id: string
  readonly type: ServerRequestType
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

export type RequestStatus = 'pending' | 'answered' | 'expired' | 'cancelled'
