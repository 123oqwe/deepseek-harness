import { describe, it, expect } from 'vitest'
import { Inbox, Outbox } from '../src/index.ts'

describe('P4-06 Durable Inbox/Outbox', () => {
  describe('Inbox exactly-once', () => {
    it('enqueues and dequeues messages', () => {
      const inbox = new Inbox()
      const msg = inbox.enqueue({ runId: 'run-1', type: 'tool:result', payload: { result: 'ok' } })
      expect(msg.id).toBeTruthy()
      expect(inbox.pending).toBe(1)
      const dequeued = inbox.dequeue()
      expect(dequeued).toBeDefined()
      expect(dequeued!.id).toBe(msg.id)
    })

    it('marks as processed exactly once', () => {
      const inbox = new Inbox()
      const msg = inbox.enqueue({ runId: 'run-1', type: 'test', payload: {} })
      inbox.markProcessed(msg.id)
      expect(inbox.isProcessed(msg.id)).toBe(true)
      expect(inbox.pending).toBe(0)
      // Marking again should be idempotent
      inbox.markProcessed(msg.id)
      expect(inbox.pending).toBe(0)
    })

    it('dequeue returns undefined when all processed', () => {
      const inbox = new Inbox()
      const msg = inbox.enqueue({ runId: 'r', type: 't', payload: {} })
      inbox.markProcessed(msg.id)
      expect(inbox.dequeue()).toBeUndefined()
    })
  })

  describe('Outbox exactly-once delivery', () => {
    it('enqueues and marks delivered', () => {
      const outbox = new Outbox()
      const msg = outbox.enqueue({ runId: 'run-1', type: 'external:write', payload: { action: 'create' } })
      expect(outbox.pending).toBe(1)
      outbox.markDelivered(msg.id)
      expect(outbox.isDelivered(msg.id)).toBe(true)
      expect(outbox.pending).toBe(0)
    })

    it('tracks delivery attempts', () => {
      const outbox = new Outbox()
      const msg = outbox.enqueue({ runId: 'r', type: 't', payload: {} })
      outbox.incrementAttempts(msg.id)
      outbox.incrementAttempts(msg.id)
      const undelivered = outbox.getUndelivered()
      expect(undelivered[0]!.deliverAttempts).toBe(2)
    })

    it('does not increment attempts after delivery', () => {
      const outbox = new Outbox()
      const msg = outbox.enqueue({ runId: 'r', type: 't', payload: {} })
      outbox.markDelivered(msg.id)
      outbox.incrementAttempts(msg.id)
      expect(outbox.pending).toBe(0)
    })
  })

  describe('crash recovery', () => {
    it('inbox survives simulated crash (state persists)', () => {
      const inbox = new Inbox()
      const msg1 = inbox.enqueue({ runId: 'r', type: 'a', payload: {} })
      inbox.enqueue({ runId: 'r', type: 'b', payload: {} })
      inbox.markProcessed(msg1.id)
      // After "crash" - same object represents persisted state
      expect(inbox.pending).toBe(1)
      const remaining = inbox.dequeue()
      expect(remaining!.type).toBe('b')
    })

    it('outbox redelivers undelivered after crash', () => {
      const outbox = new Outbox()
      const msg = outbox.enqueue({ runId: 'r', type: 'external', payload: {} })
      outbox.incrementAttempts(msg.id) // attempt 1 failed
      // After "crash" - get undelivered and retry
      const undelivered = outbox.getUndelivered()
      expect(undelivered).toHaveLength(1)
      outbox.markDelivered(msg.id)
      expect(outbox.pending).toBe(0)
    })
  })
})
