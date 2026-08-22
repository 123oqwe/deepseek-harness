import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { acquireLease, heartbeat, revokeLease, releaseLease, getLease, getActiveLeaseForRun, isExpired, getFencingToken, clearLeases } from '../src/index.ts'

describe('P4-07 Worker Lease, Heartbeat, and Fencing Token', () => {
  beforeEach(() => clearLeases())
  afterEach(() => clearLeases())

  it('acquires a lease', () => {
    const lease = acquireLease('run-1', 'worker-1')
    expect(lease.state).toBe('active')
    expect(lease.epoch).toBe(1)
    expect(lease.workerId).toBe('worker-1')
  })

  it('prevents double acquire for same run', () => {
    acquireLease('run-1', 'worker-1')
    expect(() => acquireLease('run-1', 'worker-2')).toThrow('already held')
  })

  it('heartbeat extends expiry', () => {
    const lease = acquireLease('run-1', 'worker-1', 100)
    const updated = heartbeat(String(lease.id), 30000)
    expect(updated.heartbeatCount).toBe(1)
    expect(new Date(updated.expiresAt).getTime()).toBeGreaterThan(new Date(lease.expiresAt).getTime())
  })

  it('release frees the lease', () => {
    const lease = acquireLease('run-1', 'worker-1')
    releaseLease(String(lease.id))
    const released = getLease(String(lease.id))
    expect(released!.state).toBe('released')
  })

  it('revoked lease generates fencing token', () => {
    const lease = acquireLease('run-1', 'worker-1')
    revokeLease(String(lease.id))
    const token = getFencingToken(String(lease.id))
    expect(token).toBeDefined()
  })

  it('isExpired checks state and expiry', () => {
    const lease = acquireLease('run-1', 'worker-1', 1)
    // Wait for expiry
    const expired = isExpired(lease, new Date(Date.now() + 10000))
    expect(expired).toBe(true)
  })

  it('getActiveLeaseForRun returns active lease', () => {
    acquireLease('run-1', 'worker-1')
    const active = getActiveLeaseForRun('run-1')
    expect(active).toBeDefined()
    expect(active!.workerId).toBe('worker-1')
  })

  it('after release, no active lease for run', () => {
    const lease = acquireLease('run-1', 'worker-1')
    releaseLease(String(lease.id))
    expect(getActiveLeaseForRun('run-1')).toBeUndefined()
  })
})
