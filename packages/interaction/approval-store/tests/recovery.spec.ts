import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { request, approve, deny, consume, revoke, get, getByRun, isWaiting, getPending, clearStore } from '../src/index.ts'

describe('P2-07 Persistent Approval Store', () => {
  beforeEach(() => clearStore())
  afterEach(() => clearStore())

  it('requests approval and marks run as waiting', () => {
    const rec = request('run-1', 'digest-1', '1.0', 'user-1')
    expect(rec.state).toBe('requested')
    expect(isWaiting('run-1')).toBe(true)
  })

  it('approves a request', () => {
    const rec = request('run-1', 'd', '1.0', 'u')
    const approved = approve(rec.id, 'approver')
    expect(approved.state).toBe('approved')
    expect(approved.decidedBy).toBe('approver')
    expect(isWaiting('run-1')).toBe(false)
  })

  it('denies a request', () => {
    const rec = request('run-1', 'd', '1.0', 'u')
    const denied = deny(rec.id, 'approver', 'too risky')
    expect(denied.state).toBe('denied')
    expect(denied.rejectionReason).toBe('too risky')
  })

  it('consumes an approved request', () => {
    const rec = request('run-1', 'd', '1.0', 'u')
    approve(rec.id, 'approver')
    const consumed = consume(rec.id)
    expect(consumed.state).toBe('consumed')
  })

  it('rejects consume of non-approved', () => {
    const rec = request('run-1', 'd', '1.0', 'u')
    expect(() => consume(rec.id)).toThrow('Cannot consume')
  })

  it('revokes an approval', () => {
    const rec = request('run-1', 'd', '1.0', 'u')
    approve(rec.id, 'approver')
    const revoked = revoke(rec.id)
    expect(revoked.state).toBe('revoked')
  })

  it('getByRun returns all records for a run', () => {
    request('run-1', 'd1', '1.0', 'u')
    request('run-1', 'd2', '1.0', 'u')
    request('run-2', 'd3', '1.0', 'u')
    expect(getByRun('run-1')).toHaveLength(2)
  })

  it('getPending returns only requested', () => {
    const r1 = request('run-1', 'd', '1.0', 'u')
    const r2 = request('run-2', 'd', '1.0', 'u')
    approve(r1.id, 'a')
    expect(getPending()).toHaveLength(1)
    expect(getPending()[0]!.id).toBe(r2.id)
  })
})
