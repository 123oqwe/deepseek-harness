import { describe, it, expect } from 'vitest'
import { compact } from '../src/coverage.ts'
import { ProvenanceTracker } from '../src/provenance.ts'

describe('P6-06 Compaction Fidelity', () => {
  it('compacts within budget', () => {
    const items = [
      { id: 'a', tokens: 100, importance: 0.9 },
      { id: 'b', tokens: 50, importance: 0.5 },
      { id: 'c', tokens: 200, importance: 0.3 },
    ]
    const result = compact(items, 150)
    expect(result.compactedTokens).toBeLessThanOrEqual(150)
    expect(result.preservedItems).toContain('a')
  })

  it('drops low importance first', () => {
    const items = [
      { id: 'a', tokens: 100, importance: 0.1 },
      { id: 'b', tokens: 100, importance: 0.9 },
    ]
    const result = compact(items, 100)
    expect(result.preservedItems).toContain('b')
    expect(result.droppedItems).toContain('a')
  })

  it('computes ratio', () => {
    const items = [{ id: 'a', tokens: 100, importance: 0.9 }]
    const result = compact(items, 50)
    expect(result.ratio).toBe(0)
    expect(result.fidelityScore).toBe(0)
  })

  it('preserves all when budget large', () => {
    const items = [
      { id: 'a', tokens: 10, importance: 0.5 },
      { id: 'b', tokens: 20, importance: 0.7 },
    ]
    const result = compact(items, 10000)
    expect(result.droppedItems).toHaveLength(0)
    expect(result.fidelityScore).toBe(1)
  })

  it('tracks provenance', () => {
    const tracker = new ProvenanceTracker()
    const p = tracker.record({
      sourceItemIds: ['a', 'b'], compactedItemId: 'c',
      timestamp: Date.now(), toolPaired: true, verifier: 'independent',
    })
    expect(p.compactionId).toBeDefined()
    expect(tracker.verifyToolPaired('c')).toBe(true)
  })

  it('provenance returns undefined for unknown', () => {
    const tracker = new ProvenanceTracker()
    expect(tracker.getProvenance('unknown')).toBeUndefined()
  })
})
