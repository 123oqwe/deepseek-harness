import { describe, it, expect } from 'vitest'
import { StrategyRouter, evaluateRules } from '../src/index.ts'

describe('P5-01 Strategy Router', () => {
  it('routes simple tasks to direct', () => {
    const router = new StrategyRouter()
    const result = router.route({
      taskComplexity: 'simple', requiresTools: false, requiresPlanning: false,
      requiresMultipleAgents: false, estimatedSteps: 1, hasExternalSideEffects: false,
      featureGate: 'enforce',
    })
    expect(result.strategy).toBe('direct')
  })

  it('routes tool-using tasks to react', () => {
    const result = evaluateRules({
      taskComplexity: 'moderate', requiresTools: true, requiresPlanning: false,
      requiresMultipleAgents: false, estimatedSteps: 3, hasExternalSideEffects: false,
      featureGate: 'enforce',
    })
    expect(result.strategy).toBe('react')
    expect(result.fallbackStrategy).toBe('direct')
  })

  it('routes planning tasks to plan', () => {
    const result = evaluateRules({
      taskComplexity: 'moderate', requiresTools: false, requiresPlanning: true,
      requiresMultipleAgents: false, estimatedSteps: 4, hasExternalSideEffects: false,
      featureGate: 'enforce',
    })
    expect(result.strategy).toBe('plan')
  })

  it('routes complex side-effect tasks to workflow', () => {
    const result = evaluateRules({
      taskComplexity: 'complex', requiresTools: true, requiresPlanning: true,
      requiresMultipleAgents: false, estimatedSteps: 7, hasExternalSideEffects: true,
      featureGate: 'enforce',
    })
    expect(result.strategy).toBe('workflow')
  })

  it('routes multi-agent tasks', () => {
    const result = evaluateRules({
      taskComplexity: 'multi-step', requiresTools: true, requiresPlanning: true,
      requiresMultipleAgents: true, estimatedSteps: 10, hasExternalSideEffects: true,
      featureGate: 'enforce',
    })
    expect(result.strategy).toBe('multi-agent')
  })

  it('is deterministic for same input', () => {
    const router = new StrategyRouter()
    const ctx = {
      taskComplexity: 'moderate' as const, requiresTools: true, requiresPlanning: false,
      requiresMultipleAgents: false, estimatedSteps: 3, hasExternalSideEffects: false,
      featureGate: 'enforce' as const,
    }
    expect(router.isDeterministic(ctx)).toBe(true)
  })

  it('logs in shadow mode', () => {
    const router = new StrategyRouter()
    router.route({
      taskComplexity: 'simple', requiresTools: false, requiresPlanning: false,
      requiresMultipleAgents: false, estimatedSteps: 1, hasExternalSideEffects: false,
      featureGate: 'shadow',
    })
    expect(router.getShadowLog()).toHaveLength(1)
  })

  it('does not log in enforce mode', () => {
    const router = new StrategyRouter()
    router.route({
      taskComplexity: 'simple', requiresTools: false, requiresPlanning: false,
      requiresMultipleAgents: false, estimatedSteps: 1, hasExternalSideEffects: false,
      featureGate: 'enforce',
    })
    expect(router.getShadowLog()).toHaveLength(0)
  })

  it('all decisions have confidence', () => {
    const contexts = [
      { taskComplexity: 'simple' as const, requiresTools: false, requiresPlanning: false, requiresMultipleAgents: false, estimatedSteps: 1, hasExternalSideEffects: false, featureGate: 'enforce' as const },
      { taskComplexity: 'moderate' as const, requiresTools: true, requiresPlanning: false, requiresMultipleAgents: false, estimatedSteps: 3, hasExternalSideEffects: false, featureGate: 'enforce' as const },
      { taskComplexity: 'complex' as const, requiresTools: true, requiresPlanning: true, requiresMultipleAgents: true, estimatedSteps: 10, hasExternalSideEffects: true, featureGate: 'enforce' as const },
    ]
    for (const ctx of contexts) {
      const result = evaluateRules(ctx)
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    }
  })
})
