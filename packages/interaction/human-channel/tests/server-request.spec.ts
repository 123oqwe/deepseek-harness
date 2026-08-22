import { describe, it, expect } from 'vitest'
import { HumanInteractionChannel } from '../src/index.ts'

const baseRequest = {
  id: 'req-1', type: 'approval' as const, runId: 'run-1',
  actionManifestDigest: 'abc', prompt: 'Approve payment?',
  options: ['approve', 'deny'], deadline: Date.now() + 60000,
}

describe('P8-04 Server→Client Requests', () => {
  it('sends a request', () => {
    const ch = new HumanInteractionChannel()
    const result = ch.sendRequest(baseRequest)
    expect(result.sent).toBe(true)
  })

  it('accepts a response', () => {
    const ch = new HumanInteractionChannel()
    ch.sendRequest(baseRequest)
    const result = ch.submitResponse({
      requestId: 'req-1', responder: 'alice', role: 'finance',
      decision: 'approve', timestamp: Date.now(),
    })
    expect(result.accepted).toBe(true)
    expect(result.status).toBe('answered')
  })

  it('rejects duplicate request', () => {
    const ch = new HumanInteractionChannel()
    ch.sendRequest(baseRequest)
    const result = ch.sendRequest(baseRequest)
    expect(result.sent).toBe(false)
  })

  it('rejects response for unknown request', () => {
    const ch = new HumanInteractionChannel()
    const result = ch.submitResponse({
      requestId: 'unknown', responder: 'a', role: 'r',
      decision: 'approve', timestamp: 0,
    })
    expect(result.accepted).toBe(false)
  })

  it('rejects unauthorized role', () => {
    const ch = new HumanInteractionChannel()
    ch.sendRequest({ ...baseRequest, requiredRoles: ['finance'] })
    const result = ch.submitResponse({
      requestId: 'req-1', responder: 'a', role: 'unknown',
      decision: 'approve', timestamp: Date.now(),
    })
    expect(result.accepted).toBe(false)
  })

  it('requires quorum', () => {
    const ch = new HumanInteractionChannel()
    ch.sendRequest({ ...baseRequest, requiredRoles: ['finance', 'legal'], minApprovals: 2 })
    ch.submitResponse({ requestId: 'req-1', responder: 'a', role: 'finance', decision: 'approve', timestamp: Date.now() })
    const entry = ch.getRequest('req-1')
    expect(entry?.status).toBe('pending')
    ch.submitResponse({ requestId: 'req-1', responder: 'b', role: 'legal', decision: 'approve', timestamp: Date.now() })
    const entry2 = ch.getRequest('req-1')
    expect(entry2?.status).toBe('answered')
  })

  it('cancels pending request', () => {
    const ch = new HumanInteractionChannel()
    ch.sendRequest(baseRequest)
    const result = ch.cancelRequest('req-1')
    expect(result.cancelled).toBe(true)
  })

  it('cannot cancel answered request', () => {
    const ch = new HumanInteractionChannel()
    ch.sendRequest(baseRequest)
    ch.submitResponse({ requestId: 'req-1', responder: 'a', role: 'r', decision: 'approve', timestamp: Date.now() })
    const result = ch.cancelRequest('req-1')
    expect(result.cancelled).toBe(false)
  })

  it('lists pending requests', () => {
    const ch = new HumanInteractionChannel()
    ch.sendRequest(baseRequest)
    ch.sendRequest({ ...baseRequest, id: 'req-2' })
    expect(ch.getPendingRequests()).toHaveLength(2)
  })
})
