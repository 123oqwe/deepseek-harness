import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sendControl, getMessages, isCancelled, canDeliver, getConvergenceStatus, clearMessages } from '../src/index.ts'

describe('P5-10 Control Convergence', () => {
  beforeEach(() => clearMessages())
  afterEach(() => clearMessages())

  it('sends continue message', () => {
    const msg = sendControl('continue', 'run-1', 1)
    expect(msg.type).toBe('continue')
    expect(msg.epoch).toBe(1)
  })

  it('cancel marks run as cancelled', () => {
    sendControl('cancel', 'run-1', 1)
    expect(isCancelled('run-1')).toBe(true)
  })

  it('after cancel, steer is not deliverable', () => {
    sendControl('cancel', 'run-1', 1)
    const steer = sendControl('steer', 'run-1', 1)
    expect(canDeliver(steer, 'run-1')).toBe(false)
  })

  it('after cancel, human-answer is deliverable', () => {
    sendControl('cancel', 'run-1', 1)
    const answer = sendControl('human-answer', 'run-1', 1)
    expect(canDeliver(answer, 'run-1')).toBe(true)
  })

  it('messages are sorted by priority', () => {
    sendControl('continue', 'run-1', 1)
    sendControl('cancel', 'run-1', 1)
    sendControl('steer', 'run-1', 1)
    const msgs = getMessages('run-1')
    expect(msgs[0]!.type).toBe('cancel')
    expect(msgs[1]!.type).toBe('steer')
    expect(msgs[2]!.type).toBe('continue')
  })

  it('idempotency: duplicate send returns same message', () => {
    const msg1 = sendControl('continue', 'run-1', 1, { data: 'x' })
    const msg2 = sendControl('continue', 'run-1', 1, { data: 'y' })
    expect(msg1.id).toBe(msg2.id)
  })

  it('convergence status for cancelled run', () => {
    sendControl('cancel', 'run-1', 1)
    const status = getConvergenceStatus('run-1')
    expect(status.converged).toBe(true)
  })
})
