export interface TaskBudgetSpec {
  readonly maxTokens: number
  readonly maxCost: number
  readonly maxTimeMs: number
  readonly maxAgents: number
  readonly maxToolCalls: number
}

export interface TaskItem {
  readonly id: string
  readonly tenantId: string
  readonly priority: number
  readonly budget: TaskBudgetSpec
  readonly requiredLocks: readonly string[]
  readonly parentBudgetRef?: string
}

export interface ResourceLock {
  readonly resource: string
  readonly heldBy: string
  readonly acquiredAt: number
  readonly exclusive: boolean
}

export interface ScheduledTask {
  readonly task: TaskItem
  readonly scheduledAt: number
  readonly queuePosition: number
}

export interface BackpressureSignal {
  readonly queueDepth: number
  readonly maxQueueDepth: number
  readonly activeTasks: number
  readonly maxConcurrency: number
  readonly shouldBackpressure: boolean
}
