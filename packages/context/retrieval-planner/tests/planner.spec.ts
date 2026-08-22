import { describe, it, expect } from 'vitest'
import { planRetrieval, createBudget } from '../src/index.ts'
import type { ContextNode } from '../src/index.ts'

const nodes: ContextNode[] = [
  { id: 'n1', type: 'message', content: 'hello', timestamp: 1, runId: 'r1', parentIds: [], tokenEstimate: 10, relevanceScore: 0.9 },
  { id: 'n2', type: 'tool-call', content: 'fs read', timestamp: 2, runId: 'r1', parentIds: ['n1'], tokenEstimate: 20, relevanceScore: 0.7 },
  { id: 'n3', type: 'artifact', content: 'result', timestamp: 3, runId: 'r1', parentIds: ['n2'], tokenEstimate: 50, relevanceScore: 0.5 },
  { id: 'n4', type: 'memory', content: 'old context', timestamp: 0, runId: 'r1', parentIds: [], tokenEstimate: 100, relevanceScore: 0.3 },
]

describe('P6-04 Context Graph & Retrieval Planner', () => {
  it('plans retrieval within budget', () => {
    const plan = planRetrieval(nodes, createBudget(50))
    expect(plan.includedNodes.length).toBeGreaterThan(0)
    expect(plan.totalTokens).toBeLessThanOrEqual(50)
  })

  it('includes highest relevance first', () => {
    const plan = planRetrieval(nodes, createBudget(30))
    expect(plan.includedNodes[0]?.id).toBe('n1')
  })

  it('excludes nodes that exceed budget', () => {
    const plan = planRetrieval(nodes, createBudget(15))
    expect(plan.excludedNodes.length).toBeGreaterThan(0)
  })

  it('includes all when budget is large', () => {
    const plan = planRetrieval(nodes, createBudget(10000))
    expect(plan.includedNodes).toHaveLength(4)
    expect(plan.excludedNodes).toHaveLength(0)
  })

  it('reports total tokens used', () => {
    const plan = planRetrieval(nodes, createBudget(10000))
    expect(plan.totalTokens).toBe(180)
  })

  it('budget tracking is accurate', () => {
    const plan = planRetrieval(nodes, createBudget(30))
    expect(plan.budget.remaining).toBeGreaterThanOrEqual(0)
    expect(plan.budget.remaining + plan.budget.usedTokens).toBe(plan.budget.maxTokens)
  })
})
