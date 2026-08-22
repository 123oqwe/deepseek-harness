import type { TaskItem } from './types.ts'

export class FairnessScheduler {
  private readonly tenantQueues = new Map<string, TaskItem[]>()
  private readonly tenantLastRun = new Map<string, number>()
  // eslint-disable-next-line no-useless-constructor
  constructor(_maxPerTenant: number = 5) {}


  enqueue(task: TaskItem): void {
    const queue = this.tenantQueues.get(task.tenantId) ?? []
    queue.push(task)
    queue.sort((a, b) => b.priority - a.priority)
    this.tenantQueues.set(task.tenantId, queue)
  }

  dequeue(now: number): TaskItem | undefined {
    let bestTenant: string | undefined
    let bestScore = -Infinity

    for (const [tenantId, queue] of this.tenantQueues) {
      if (queue.length === 0) continue
      const lastRun = this.tenantLastRun.get(tenantId)
      const topPriority = queue[0]?.priority ?? 0
      // Never-run tenants get infinite age boost
      const ageBonus = lastRun === undefined ? 100000 : Math.floor((now - lastRun) / 10)
      const effectiveScore = topPriority + ageBonus

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore
        bestTenant = tenantId
      }
    }

    if (!bestTenant) return undefined
    const queue = this.tenantQueues.get(bestTenant)
    if (!queue || queue.length === 0) return undefined
    const task = queue.shift()
    if (task) {
      this.tenantLastRun.set(bestTenant, now)
      if (queue.length === 0) {
        this.tenantQueues.delete(bestTenant)
      }
    }
    return task
  }

  getQueueDepth(): number {
    let total = 0
    for (const queue of this.tenantQueues.values()) {
      total += queue.length
    }
    return total
  }

  getTenantQueueDepth(tenantId: string): number {
    return this.tenantQueues.get(tenantId)?.length ?? 0
  }
}
