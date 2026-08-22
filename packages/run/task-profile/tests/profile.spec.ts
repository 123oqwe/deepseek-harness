import { describe, it, expect } from 'vitest'
import { validateProfile, isValidProfile, type TaskProfile } from '../src/index.ts'

const valid: TaskProfile = {
  id: 'task-1', kind: 'code', strategy: 'plan', description: 'Fix bug',
  model: 'deepseek-chat', provider: 'deepseek', tools: ['fs:read', 'fs:write'],
  world: 'local', budget: { tokens: 10000, cost: 0.5, time: 300 },
  verification: { method: 'test', criteria: ['all tests pass'] },
  constraints: ['no network', 'workspace only'],
}

describe('P4-02 TaskProfile', () => {
  it('validates a complete profile', () => {
    const errors = validateProfile(valid)
    expect(errors).toHaveLength(0)
    expect(isValidProfile(valid)).toBe(true)
  })

  it('rejects missing required fields', () => {
    const errors = validateProfile({})
    expect(errors.length).toBeGreaterThan(5)
    expect(errors).toContain('id is required')
    expect(errors).toContain('model is required')
  })

  it('rejects non-positive budget', () => {
    const errors = validateProfile({ ...valid, budget: { tokens: 0, cost: 0, time: 0 } } as any)
    expect(errors).toContain('budget.tokens must be positive')
  })

  it('rejects missing tools array', () => {
    const errors = validateProfile({ ...valid, tools: undefined } as any)
    expect(errors.some(e => e.includes('tools'))).toBe(true)
  })

  it('isValidProfile returns boolean', () => {
    expect(isValidProfile(valid)).toBe(true)
    expect(isValidProfile({})).toBe(false)
  })
})
