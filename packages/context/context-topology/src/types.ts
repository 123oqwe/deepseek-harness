export type ContextZone = 'shared' | 'private' | 'retrievable'

export interface ContextSource {
  readonly id: string
  readonly type: 'system' | 'tool' | 'memory' | 'retrieval' | 'user'
  readonly zone: ContextZone
  readonly content: string
}

export interface AgentContextTopology {
  readonly agentId: string
  readonly zones: {
    readonly shared: readonly ContextSource[]
    readonly private: readonly ContextSource[]
    readonly retrievable: readonly ContextSource[]
  }
}

export interface TopologyEntry {
  readonly agentId: string
  readonly parentAgentId?: string | undefined
  readonly sources: readonly ContextSource[]
}
