import { describe, it, expect } from 'vitest'
import { Scheduler, TaskQueue, ResourceLockManager, FairnessScheduler } from '../src/index.ts'

const task = (id: string, tenant: string, priority = 1) => ({
  id, tenantId: tenant, priority,
  budget: { maxTokens: 1000, maxCost: 0.5, maxTimeMs: 300, maxAgents: 1, maxToolCalls: 10 },
  requiredLocks: [] as string[],
})

describe('P4-10 Scheduler', () => {
  describe('TaskQueue', () => {
    it('enqueues and dequeues by priority', () => {
      const q = new TaskQueue()
      q.enqueue(task('t1', 'a', 1))
      q.enqueue(task('t2', 'a', 5))
      q.enqueue(task('t3', 'a', 3))
      expect(q.dequeue()?.id).toBe('t2') // highest priority
      expect(q.dequeue()?.id).toBe('t3')
    })

    it('removes by id', () => {
      const q = new TaskQueue()
      q.enqueue(task('t1', 'a'))
      q.enqueue(task('t2', 'a'))
      q.remove('t1')
      expect(q.length).toBe(1)
    })
  })

  describe('ResourceLockManager', () => {
    it('acquires exclusive lock', () => {
      const lm = new ResourceLockManager()
      const result = lm.acquire('file.txt', 't1', true, 0)
      expect(result.acquired).toBe(true)
    })

    it('blocks second exclusive lock', () => {
      const lm = new ResourceLockManager()
      lm.acquire('file.txt', 't1', true, 0)
      const result = lm.acquire('file.txt', 't2', true, 0)
      expect(result.acquired).toBe(false)
    })

    it('allows shared locks', () => {
      const lm = new ResourceLockManager()
      lm.acquire('file.txt', 't1', false, 0)
      const result = lm.acquire('file.txt', 't2', false, 0)
      expect(result.acquired).toBe(true)
    })

    it('blocks exclusive when shared held', () => {
      const lm = new ResourceLockManager()
      lm.acquire('file.txt', 't1', false, 0)
      const result = lm.acquire('file.txt', 't2', true, 0)
      expect(result.acquired).toBe(false)
    })

    it('releases all locks for a task', () => {
      const lm = new ResourceLockManager()
      lm.acquire('a', 't1', true, 0)
      lm.acquire('b', 't1', true, 0)
      const released = lm.releaseAll('t1')
      expect(released).toHaveLength(2)
    })
  })

  describe('FairnessScheduler', () => {
    it('schedules across tenants fairly', () => {
      const fs = new FairnessScheduler()
      fs.enqueue(task('t1', 'tenant-a', 1))
      fs.enqueue(task('t2', 'tenant-b', 1))
      fs.enqueue(task('t3', 'tenant-a', 1))
      // First dequeue: either tenant (both priority 1, no last run)
      const first = fs.dequeue(0)
      expect(first).toBeDefined()
      const second = fs.dequeue(1)
      // After first runs, second should be from the other tenant
      expect(second?.tenantId).not.toBe(first?.tenantId)
    })

    it('aging boosts old tenant priority', () => {
      const fs = new FairnessScheduler()
      fs.enqueue(task('t1', 'tenant-a', 1))
      fs.enqueue(task('t2', 'tenant-b', 5))
      // t2 has higher priority, so dequeued first
      fs.dequeue(0)
      // Now t1 from tenant-a, but tenant-b hasn't waited long
      // With aging at time 100, tenant-a gets boost
      fs.enqueue(task('t3', 'tenant-b', 5))
      const result = fs.dequeue(100)
      // tenant-a's effective priority = 1 + 100 = 101, tenant-b's = 5 + 0 = 5
      expect(result?.tenantId).toBe('tenant-a')
    })
  })

  describe('Scheduler', () => {
    it('submits and schedules a task', () => {
      const s = new Scheduler(10, 100)
      s.submit(task('t1', 'a'))
      const result = s.schedule(0)
      expect(result.task?.id).toBe('t1')
    })

    it('respects max concurrency', () => {
      const s = new Scheduler(1, 100)
      s.submit(task('t1', 'a'))
      s.submit(task('t2', 'a'))
      s.schedule(0)
      const result = s.schedule(1)
      expect(result.task).toBeUndefined()
      expect(result.reason).toContain('concurrency')
    })

    it('acquires required locks', () => {
      const s = new Scheduler(10, 100)
      s.submit({ ...task('t1', 'a'), requiredLocks: ['resource-1'] })
      const result = s.schedule(0)
      expect(result.locksAcquired).toContain('resource-1')
    })

    it('blocks on locked resource', () => {
      const s = new Scheduler(10, 100)
      s.submit({ ...task('t1', 'a'), requiredLocks: ['resource-1'] })
      s.submit({ ...task('t2', 'a'), requiredLocks: ['resource-1'] })
      s.schedule(0) // t1 gets the lock
      const result = s.schedule(1) // t2 blocked
      expect(result.task).toBeUndefined()
      expect(result.reason).toContain('lock')
    })

    it('releases locks on completion', () => {
      const s = new Scheduler(10, 100)
      s.submit({ ...task('t1', 'a'), requiredLocks: ['resource-1'] })
      s.schedule(0)
      const result = s.complete('t1')
      expect(result.completed).toBe(true)
      expect(result.releasedLocks).toContain('resource-1')
    })

    it('signals backpressure when queue full', () => {
      const s = new Scheduler(10, 2)
      s.submit(task('t1', 'a'))
      s.submit(task('t2', 'a'))
      const bp = s.getBackpressure()
      expect(bp.shouldBackpressure).toBe(true)
    })

    it('cancels task and releases locks', () => {
      const s = new Scheduler(10, 100)
      s.submit({ ...task('t1', 'a'), requiredLocks: ['r1'] })
      s.schedule(0)
      const result = s.cancel('t1')
      expect(result.completed).toBe(true)
    })
  })
})
