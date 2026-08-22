import { describe, it, expect } from 'vitest'
import { classifyRisk } from '../src/index.ts'

describe('P2-04 Risk Taxonomy', () => {
  it('classifies read as low risk', () => {
    const result = classifyRisk('read')
    expect(result.riskLevel).toBe('low')
    expect(result.requiresApproval).toBe(false)
  })

  it('classifies local-write as medium risk', () => {
    const result = classifyRisk('local-write')
    expect(result.riskLevel).toBe('medium')
    expect(result.requiresApproval).toBe(false)
  })

  it('classifies network-write as high risk', () => {
    const result = classifyRisk('network-write')
    expect(result.riskLevel).toBe('high')
    expect(result.requiresApproval).toBe(true)
  })

  it('classifies external as critical risk', () => {
    const result = classifyRisk('external')
    expect(result.riskLevel).toBe('critical')
    expect(result.requiresDualApproval).toBe(true)
    expect(result.requiresIdempotency).toBe(true)
  })

  it('classifies irreversible with compensation', () => {
    const result = classifyRisk('irreversible')
    expect(result.riskLevel).toBe('irreversible')
    expect(result.requiresCompensation).toBe(true)
  })

  it('sensitivity boosts risk level', () => {
    const result = classifyRisk('read', 'restricted')
    expect(result.riskLevel).not.toBe('low')
  })

  it('payment tool overrides to critical', () => {
    const result = classifyRisk('external', 'restricted', 'payment:transfer')
    expect(result.riskLevel).toBe('critical')
    expect(result.requiresDualApproval).toBe(true)
  })

  it('delete tool overrides to irreversible', () => {
    const result = classifyRisk('local-write', 'internal', 'file:delete')
    expect(result.riskLevel).toBe('irreversible')
  })
})
