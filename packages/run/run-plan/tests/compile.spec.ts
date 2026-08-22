import { describe, it, expect } from 'vitest'
import { compile, verifyPlan, type CompileInput } from '../src/index.ts'

const input: CompileInput = {
  objectives: ['fix bug', 'run tests'],
  constraints: ['no network', 'workspace only'],
  modelRoutes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
  agents: [{
    id: 'agent-1', role: 'coder',
    modelRoute: { provider: 'deepseek', model: 'deepseek-chat' },
    tools: ['fs:read', 'fs:write'], worldId: 'world-1',
  }],
  worlds: [{ id: 'world-1', kind: 'local', policyDigest: 'policy-hash' }],
  budgets: [{ tokens: 10000, cost: 0.5, time: 300, agents: 1 }],
  verification: { method: 'test', criteria: ['all pass'], verifier: 'independent' },
}

describe('P4-03 RunPlan', () => {
  it('compiles a valid plan', () => {
    const plan = compile(input)
    expect(plan.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(plan.agentGraph).toHaveLength(1)
  })

  it('rejects agent with unknown world', () => {
    const bad = { ...input, agents: [{ ...input.agents[0]!, worldId: 'unknown' }] }
    expect(() => compile(bad)).toThrow('unknown world')
  })

  it('rejects insufficient budget', () => {
    const bad = { ...input, budgets: [{ tokens: 100, cost: 0.1, time: 10, agents: 0 }] }
    expect(() => compile(bad)).toThrow('Budget')
  })

  it('verifyPlan passes for valid plan', () => {
    const plan = compile(input)
    const result = verifyPlan(plan)
    expect(result.valid).toBe(true)
  })

  it('same input produces same digest', () => {
    const p1 = compile(input)
    const p2 = compile(input)
    expect(p1.digest).toBe(p2.digest)
  })
})
