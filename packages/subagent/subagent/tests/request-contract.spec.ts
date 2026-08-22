import { describe, it, expect } from 'vitest'
import { validateSubagentRequest, attenuateBudget, type SubagentRequest } from '../src/request.ts'

const validReq: SubagentRequest = {
  id: 'sub-1', parentId: 'parent-1', runId: 'run-1',
  taskDescription: 'Review code', objective: 'Find bugs',
  constraints: ['no network'],
  capabilityTokenDigest: 'token-hash',
  budgetAllocation: { maxTokens: 1000, maxCost: 0.5, maxTimeMs: 300, maxAgents: 1 },
  worldId: 'world-1', requiredTools: ['fs:read'],
  priority: 1, deadline: 60000, traceId: 'trace-1',
  status: 'pending',
}

describe('P5-05 SubagentRequest Contract', () => {
  it('validates a correct request', () => {
    const result = validateSubagentRequest(validReq)
    expect(result.valid).toBe(true)
  })

  it('rejects missing id', () => {
    const result = validateSubagentRequest({ ...validReq, id: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('id'))).toBe(true)
  })

  it('rejects missing capabilityTokenDigest', () => {
    const result = validateSubagentRequest({ ...validReq, capabilityTokenDigest: '' })
    expect(result.valid).toBe(false)
  })

  it('rejects zero budget', () => {
    const result = validateSubagentRequest({
      ...validReq,
      budgetAllocation: { maxTokens: 0, maxCost: 0, maxTimeMs: 0, maxAgents: 0 },
    })
    expect(result.valid).toBe(false)
  })

  it('rejects missing worldId', () => {
    const result = validateSubagentRequest({ ...validReq, worldId: '' })
    expect(result.valid).toBe(false)
  })

  it('rejects no required tools', () => {
    const result = validateSubagentRequest({ ...validReq, requiredTools: [] })
    expect(result.valid).toBe(false)
  })

  it('attenuates child budget to parent', () => {
    const parent = { maxTokens: 5000, maxCost: 5, maxTimeMs: 1000, maxAgents: 3 }
    const child = { maxTokens: 10000, maxCost: 10, maxTimeMs: 2000, maxAgents: 5 }
    const result = attenuateBudget(parent, child)
    expect(result.attenuated).toBe(true)
    expect(result.budget.maxTokens).toBe(5000)
    expect(result.budget.maxAgents).toBe(3)
  })

  it('does not attenuate when child is smaller', () => {
    const parent = { maxTokens: 5000, maxCost: 5, maxTimeMs: 1000, maxAgents: 3 }
    const child = { maxTokens: 1000, maxCost: 1, maxTimeMs: 300, maxAgents: 1 }
    const result = attenuateBudget(parent, child)
    expect(result.attenuated).toBe(false)
    expect(result.budget.maxTokens).toBe(1000)
  })

  it('has verificationContractRef as optional', () => {
    expect(validReq.verificationContractRef).toBeUndefined()
    const withRef = { ...validReq, verificationContractRef: 'vc-1' }
    expect(withRef.verificationContractRef).toBe('vc-1')
  })
})
