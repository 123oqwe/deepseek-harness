export interface ProviderEvent {
  readonly type: string
  readonly data: unknown
  readonly timestamp: number
}

export interface MappedEvent {
  readonly childEventId: string
  readonly type: 'progress' | 'tool_request' | 'tool_result' | 'diff' | 'usage' | 'artifact' | 'error' | 'completed'
  readonly data: unknown
  readonly timestamp: number
}

export interface ContinuationToken {
  readonly providerId: string
  readonly threadId: string
  readonly turnId: string
  readonly resumeToken: string
}

export interface ProviderResult {
  readonly answer: string
  readonly events: readonly MappedEvent[]
  readonly usage: { inputTokens: number; outputTokens: number }
  readonly artifacts: readonly string[]
  readonly continuation: ContinuationToken | undefined
}
