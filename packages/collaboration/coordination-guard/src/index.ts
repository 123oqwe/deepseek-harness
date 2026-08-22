export interface AgentLock {
  readonly resource: string
  readonly agentId: string
  readonly acquiredAt: number
}

export class CoordinationGuard {
  private locks = new Map<string, AgentLock>()

  acquireLock(resource: string, agentId: string, now: number): { acquired: boolean; reason: string } {
    const existing = this.locks.get(resource)
    if (existing && existing.agentId !== agentId) {
      return { acquired: false, reason: `Resource ${resource} locked by ${existing.agentId}` }
    }
    this.locks.set(resource, { resource, agentId, acquiredAt: now })
    return { acquired: true, reason: 'acquired' }
  }

  releaseLock(resource: string, agentId: string): { released: boolean } {
    const lock = this.locks.get(resource)
    if (lock && lock.agentId === agentId) {
      this.locks.delete(resource)
      return { released: true }
    }
    return { released: false }
  }

  detectDeadlock(agentIds: readonly string[]): { hasDeadlock: boolean; cycle: readonly string[] } {
    // Simple cycle detection: if A waits for B's lock and B waits for A's lock
    const waitGraph = new Map<string, Set<string>>()
    for (const agent of agentIds) {
      waitGraph.set(agent, new Set())
    }
    // Check if any agent holds a lock that another agent needs
    for (const [, lock] of this.locks) {
      for (const agent of agentIds) {
        if (agent !== lock.agentId) {
          waitGraph.get(agent)?.add(lock.agentId)
        }
      }
    }
    // Simple cycle detection
    for (const [agent, waits] of waitGraph) {
      for (const target of waits) {
        if (waitGraph.get(target)?.has(agent)) {
          return { hasDeadlock: true, cycle: [agent, target] }
        }
      }
    }
    return { hasDeadlock: false, cycle: [] }
  }

  releaseAll(agentId: string): number {
    let count = 0
    for (const [, lock] of this.locks) {
      if (lock.agentId === agentId) {
        this.locks.delete(lock.resource)
        count++
      }
    }
    return count
  }
}
