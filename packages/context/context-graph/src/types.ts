export interface ContextNode {
  readonly id: string
  readonly type: 'message' | 'tool-call' | 'artifact' | 'memory' | 'approval' | 'action'
  readonly content: string
  readonly timestamp: number
  readonly runId: string
  readonly agentId?: string
  readonly parentIds: readonly string[]
  readonly tokenEstimate: number
  readonly relevanceScore: number
}

export interface ContextEdge {
  readonly from: string
  readonly to: string
  readonly relation: 'causes' | 'references' | 'replies-to' | 'spawned-by' | 'depends-on'
}
