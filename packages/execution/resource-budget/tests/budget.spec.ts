import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setBudget, recordUsage, checkBudget, getUsage, clearBudgets, type BudgetSpec } from '../src/index.ts'

const spec: BudgetSpec = {
  maxWallTimeSeconds: 300, maxCpuPercent: 50, maxMemoryMB: 512, maxDiskMB: 1024,
  maxProcesses: 4, maxNetworkBytes: 1000000, maxToolCalls: 100, maxAgents: 5,
}

describe('P3-10 Resource Budget', () => {
  beforeEach(() => clearBudgets())
  afterEach(() => clearBudgets())

  it('sets and checks budget', () => {
    setBudget('run', 'run-1', spec)
    const result = checkBudget('run', 'run-1')
    expect(result.exceeded).toBe(false)
  })

  it('records usage and detects exceeded', () => {
    setBudget('run', 'run-1', spec)
    recordUsage('run', 'run-1', { memoryMB: 600 })
    const result = checkBudget('run', 'run-1')
    expect(result.exceeded).toBe(true)
    expect(result.fields).toContain('memory')
  })

  it('accumulates usage', () => {
    setBudget('run', 'run-1', spec)
    recordUsage('run', 'run-1', { toolCalls: 10 })
    recordUsage('run', 'run-1', { toolCalls: 10 })
    const usage = getUsage('run', 'run-1')
    expect(usage!.toolCalls).toBe(20)
  })

  it('max fields track peak', () => {
    setBudget('run', 'run-1', spec)
    recordUsage('run', 'run-1', { processes: 2 })
    recordUsage('run', 'run-1', { processes: 1 })
    const usage = getUsage('run', 'run-1')
    expect(usage!.processes).toBe(2)
  })

  it('network bytes accumulate', () => {
    setBudget('run', 'run-1', spec)
    recordUsage('run', 'run-1', { networkBytes: 500000 })
    recordUsage('run', 'run-1', { networkBytes: 600000 })
    const result = checkBudget('run', 'run-1')
    expect(result.exceeded).toBe(true)
    expect(result.fields).toContain('network')
  })
})
