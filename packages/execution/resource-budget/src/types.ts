export interface BudgetSpec {
  readonly maxWallTimeSeconds: number
  readonly maxCpuPercent: number
  readonly maxMemoryMB: number
  readonly maxDiskMB: number
  readonly maxProcesses: number
  readonly maxNetworkBytes: number
  readonly maxToolCalls: number
  readonly maxAgents: number
}

export interface BudgetUsage {
  readonly wallTimeSeconds: number
  readonly cpuPercent: number
  readonly memoryMB: number
  readonly diskMB: number
  readonly processes: number
  readonly networkBytes: number
  readonly toolCalls: number
  readonly agents: number
}

export type BudgetScope = 'action' | 'run' | 'tenant'

export interface BudgetEntry {
  readonly scope: BudgetScope
  readonly scopeId: string
  readonly spec: BudgetSpec
  readonly usage: BudgetUsage
}
