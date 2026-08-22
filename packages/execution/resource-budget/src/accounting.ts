import type { BudgetSpec, BudgetUsage, BudgetEntry, BudgetScope } from './types.ts'

const ZERO_USAGE: BudgetUsage = {
  wallTimeSeconds: 0, cpuPercent: 0, memoryMB: 0, diskMB: 0,
  processes: 0, networkBytes: 0, toolCalls: 0, agents: 0,
}

const entries = new Map<string, BudgetEntry>()

function key(scope: BudgetScope, scopeId: string): string {
  return `${scope}:${scopeId}`
}

export function setBudget(scope: BudgetScope, scopeId: string, spec: BudgetSpec): void {
  entries.set(key(scope, scopeId), { scope, scopeId, spec, usage: { ...ZERO_USAGE } })
}

export function recordUsage(scope: BudgetScope, scopeId: string, delta: Partial<BudgetUsage>): BudgetEntry {
  const k = key(scope, scopeId)
  const entry = entries.get(k)
  if (!entry) throw new Error(`Budget not set for ${k}`)
  const newUsage: BudgetUsage = {
    wallTimeSeconds: entry.usage.wallTimeSeconds + (delta.wallTimeSeconds ?? 0),
    cpuPercent: Math.max(entry.usage.cpuPercent, delta.cpuPercent ?? 0),
    memoryMB: entry.usage.memoryMB + (delta.memoryMB ?? 0),
    diskMB: entry.usage.diskMB + (delta.diskMB ?? 0),
    processes: Math.max(entry.usage.processes, delta.processes ?? 0),
    networkBytes: entry.usage.networkBytes + (delta.networkBytes ?? 0),
    toolCalls: entry.usage.toolCalls + (delta.toolCalls ?? 0),
    agents: Math.max(entry.usage.agents, delta.agents ?? 0),
  }
  const updated: BudgetEntry = { ...entry, usage: newUsage }
  entries.set(k, updated)
  return updated
}

export function checkBudget(scope: BudgetScope, scopeId: string): { exceeded: boolean; fields: string[] } {
  const entry = entries.get(key(scope, scopeId))
  if (!entry) return { exceeded: false, fields: [] }
  const exceeded: string[] = []
  if (entry.usage.wallTimeSeconds > entry.spec.maxWallTimeSeconds) exceeded.push('wallTime')
  if (entry.usage.cpuPercent > entry.spec.maxCpuPercent) exceeded.push('cpu')
  if (entry.usage.memoryMB > entry.spec.maxMemoryMB) exceeded.push('memory')
  if (entry.usage.diskMB > entry.spec.maxDiskMB) exceeded.push('disk')
  if (entry.usage.processes > entry.spec.maxProcesses) exceeded.push('processes')
  if (entry.usage.networkBytes > entry.spec.maxNetworkBytes) exceeded.push('network')
  if (entry.usage.toolCalls > entry.spec.maxToolCalls) exceeded.push('toolCalls')
  if (entry.usage.agents > entry.spec.maxAgents) exceeded.push('agents')
  return { exceeded: exceeded.length > 0, fields: exceeded }
}

export function getUsage(scope: BudgetScope, scopeId: string): BudgetUsage | undefined {
  return entries.get(key(scope, scopeId))?.usage
}

export function clearBudgets(): void {
  entries.clear()
}
