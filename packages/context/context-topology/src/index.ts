import type { ContextSource, TopologyEntry, AgentContextTopology } from './types.ts'

export type { ContextSource, ContextZone, TopologyEntry, AgentContextTopology } from './types.ts'

const topologies = new Map<string, TopologyEntry>()

export function registerAgent(agentId: string, sources: readonly ContextSource[], parentAgentId?: string): void {
  topologies.set(agentId, { agentId, parentAgentId: parentAgentId ?? undefined, sources })
}

export function getTopology(agentId: string): TopologyEntry | undefined {
  return topologies.get(agentId)
}

export function assembleContext(agentId: string): AgentContextTopology {
  const entry = topologies.get(agentId)
  if (!entry) {
    return { agentId, zones: { shared: [], private: [], retrievable: [] } }
  }

  let visibleSources = entry.sources.filter(s => s.zone !== 'private')

  let parent = entry.parentAgentId
  while (parent) {
    const parentEntry = topologies.get(parent)
    if (!parentEntry) break
    visibleSources = [...visibleSources, ...parentEntry.sources.filter(s => s.zone === 'shared' || s.zone === 'retrievable')]
    parent = parentEntry.parentAgentId
  }

  const shared = visibleSources.filter(s => s.zone === 'shared')
  const retrievable = visibleSources.filter(s => s.zone === 'retrievable')
  const privateSources = entry.sources.filter(s => s.zone === 'private')

  return {
    agentId,
    zones: { shared, private: privateSources, retrievable },
  }
}

export function canAccess(requesterId: string, targetId: string): boolean {
  if (requesterId === targetId) return true
  const target = topologies.get(targetId)
  if (!target) return false
  return target.sources.every(s => s.zone !== 'private')
}

export function clearTopologies(): void {
  topologies.clear()
}
