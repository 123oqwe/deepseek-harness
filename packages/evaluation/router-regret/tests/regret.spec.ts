import { describe, it, expect } from 'vitest'
import { RouterRegretEvaluator } from '../src/index.ts'

describe('P5-12 Router Regret', () => {
  it('evaluates routing regret', () => {
    const evaluator = new RouterRegretEvaluator()
    evaluator.record({ chosen: 'react', alternatives: ['plan'], success: false, timestamp: 0 })
    evaluator.record({ chosen: 'plan', alternatives: ['react'], success: true, timestamp: 1 })
    const scores = evaluator.evaluate()
    expect(scores.length).toBe(2)
    const reactScore = scores.find(s => s.decision === 'react')
    expect(reactScore?.regret).toBeGreaterThan(0)
  })
})
