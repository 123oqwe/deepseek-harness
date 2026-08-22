import { describe, it, expect } from 'vitest'
import { CoordinationGuard } from '../src/index.ts'

describe('P5-12 Multi-Agent Coordination', () => {
  describe('CoordinationGuard', () => {
    it('acquires and releases locks', () => {
      const g = new CoordinationGuard()
      expect(g.acquireLock('file.ts', 'a1', 0).acquired).toBe(true)
      expect(g.acquireLock('file.ts', 'a2', 1).acquired).toBe(false)
      g.releaseLock('file.ts', 'a1')
      expect(g.acquireLock('file.ts', 'a2', 2).acquired).toBe(true)
    })

    it('detects deadlock cycle', () => {
      const g = new CoordinationGuard()
      g.acquireLock('r1', 'a1', 0)
      g.acquireLock('r2', 'a2', 1)
      const result = g.detectDeadlock(['a1', 'a2'])
      expect(result.hasDeadlock).toBe(true)
    })

    it('releases all locks for agent', () => {
      const g = new CoordinationGuard()
      g.acquireLock('r1', 'a1', 0)
      g.acquireLock('r2', 'a1', 0)
      expect(g.releaseAll('a1')).toBe(2)
    })

    it('no deadlock with single agent', () => {
      const g = new CoordinationGuard()
      g.acquireLock('r1', 'a1', 0)
      const result = g.detectDeadlock(['a1'])
      expect(result.hasDeadlock).toBe(false)
    })
  })
})
