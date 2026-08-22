import type { ServerRequest, ServerResponse } from '@deepseek-ai/dsh-human-channel'

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
