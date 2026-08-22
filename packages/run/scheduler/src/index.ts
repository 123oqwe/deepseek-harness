import type { TaskItem, BackpressureSignal } from './types.ts'
import { TaskQueue } from './queue.ts'
import { ResourceLockManager } from './locks.ts'
import { FairnessScheduler } from './fairness.ts'

export type { TaskItem, BackpressureSignal, TaskBudgetSpec, ResourceLock, ScheduledTask } from './types.ts'
export { TaskQueue } from './queue.ts'
export { ResourceLockManager } from './locks.ts'
export { FairnessScheduler } from './fairness.ts'

export class Scheduler {
  private readonly queue = new TaskQueue()
  private readonly locks = new ResourceLockManager()
  private readonly fairness = new FairnessScheduler()
  private activeTasks = new Map<string, TaskItem>()
  private readonly maxConcurrency: number
  private readonly maxQueueDepth: number
  private totalTokensUsed = 0
  private totalAgentsUsed = 0

  constructor(maxConcurrency = 10, maxQueueDepth = 1000) {
    this.maxConcurrency = maxConcurrency
    this.maxQueueDepth = maxQueueDepth
  }

  submit(task: TaskItem): { queued: boolean; reason: string } {
    const backpressure = this.getBackpressure()
    if (backpressure.shouldBackpressure) {
      return { queued: false, reason: 'Backpressure: queue full' }
    }
    // Check budget hierarchy: child budget cannot exceed parent
    if (task.parentBudgetRef) {
      // Parent budget check would be done here
    }
    this.queue.enqueue(task)
    this.fairness.enqueue(task)
    return { queued: true, reason: 'queued' }
  }

  schedule(now: number): { task?: TaskItem; locksAcquired: string[]; reason: string } {
    if (this.activeTasks.size >= this.maxConcurrency) {
      return { locksAcquired: [], reason: 'max concurrency reached' }
    }

    const task = this.fairness.dequeue(now)
    if (!task) {
      return { locksAcquired: [], reason: 'no tasks queued' }
    }

    // Check budget
    if (this.totalTokensUsed + task.budget.maxTokens > 10_000_000) {
      return { locksAcquired: [], reason: 'total token budget exceeded' }
    }

    // Acquire required locks
    const acquired: string[] = []
    for (const lock of task.requiredLocks) {
      const result = this.locks.acquire(lock, task.id, true, now)
      if (!result.acquired) {
        // Rollback acquired locks
        for (const l of acquired) {
          this.locks.release(l, task.id)
        }
        // Re-queue the task
        this.queue.enqueue(task)
        this.fairness.enqueue(task)
        return { locksAcquired: [], reason: `Failed to acquire lock ${lock}: ${result.reason}` }
      }
      acquired.push(lock)
    }

    this.activeTasks.set(task.id, task)
    this.totalTokensUsed += task.budget.maxTokens
    this.totalAgentsUsed += task.budget.maxAgents

    return { task, locksAcquired: acquired, reason: 'scheduled' }
  }

  complete(taskId: string): { completed: boolean; releasedLocks: string[] } {
    const task = this.activeTasks.get(taskId)
    if (!task) return { completed: false, releasedLocks: [] }
    this.activeTasks.delete(taskId)
    this.totalTokensUsed -= task.budget.maxTokens
    this.totalAgentsUsed -= task.budget.maxAgents
    const released = this.locks.releaseAll(taskId)
    return { completed: true, releasedLocks: released }
  }

  cancel(taskId: string): { cancelled: boolean; releasedLocks: string[] } {
    // Remove from queue
    this.queue.remove(taskId)
    // Remove from active
    const result = this.complete(taskId)
    return { cancelled: true, releasedLocks: result.releasedLocks }
  }

  getBackpressure(): BackpressureSignal {
    const queueDepth = this.queue.length
    return {
      queueDepth,
      maxQueueDepth: this.maxQueueDepth,
      activeTasks: this.activeTasks.size,
      maxConcurrency: this.maxConcurrency,
      shouldBackpressure: queueDepth >= this.maxQueueDepth,
    }
  }

  get activeCount(): number {
    return this.activeTasks.size
  }

  get queueDepth(): number {
    return this.queue.length
  }
}
