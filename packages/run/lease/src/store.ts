import { randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Lease, LeaseId, FencingToken } from './types.ts'

function asLeaseId(s: string): LeaseId {
  return s as Branded<'LeaseId'>
}

function asFencingToken(s: string): FencingToken {
  return s as Branded<'FencingToken'>
}

const leases = new Map<string, Lease>()
const fencingTokens = new Map<string, FencingToken>()

export function acquireLease(runId: string, workerId: string, ttlMs: number = 30000): Lease {
  const existing = Array.from(leases.values()).find(l => l.runId === runId && l.state === 'active')
  if (existing) {
    throw new Error(`Lease already held for run ${runId} by worker ${existing.workerId}`)
  }
  const now = Date.now()
  const lease: Lease = {
    id: asLeaseId(randomUUID()),
    runId,
    workerId,
    epoch: 1,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    heartbeatCount: 0,
    state: 'active',
  }
  leases.set(String(lease.id), lease)
  return lease
}

export function heartbeat(leaseId: string, ttlMs: number = 30000): Lease {
  const lease = leases.get(leaseId)
  if (!lease) throw new Error(`Lease not found: ${leaseId}`)
  if (lease.state !== 'active') throw new Error(`Lease is ${lease.state}, cannot heartbeat`)
  const now = Date.now()
  if (now > new Date(lease.expiresAt).getTime()) {
    const expired: Lease = { ...lease, state: 'expired' }
    leases.set(leaseId, expired)
    throw new Error(`Lease expired before heartbeat`)
  }
  const updated: Lease = {
    ...lease,
    expiresAt: new Date(now + ttlMs).toISOString(),
    heartbeatCount: lease.heartbeatCount + 1,
  }
  leases.set(leaseId, updated)
  return updated
}

export function revokeLease(leaseId: string): Lease {
  const lease = leases.get(leaseId)
  if (!lease) throw new Error(`Lease not found: ${leaseId}`)
  const revoked: Lease = { ...lease, state: 'revoked' }
  leases.set(leaseId, revoked)
  const token = asFencingToken(randomUUID())
  fencingTokens.set(leaseId, token)
  return revoked
}

export function releaseLease(leaseId: string): Lease {
  const lease = leases.get(leaseId)
  if (!lease) throw new Error(`Lease not found: ${leaseId}`)
  const released: Lease = { ...lease, state: 'released' }
  leases.set(leaseId, released)
  return released
}

export function getLease(leaseId: string): Lease | undefined {
  return leases.get(leaseId)
}

export function getActiveLeaseForRun(runId: string): Lease | undefined {
  return Array.from(leases.values()).find(l => l.runId === runId && l.state === 'active')
}

export function isExpired(lease: Lease, now: Date = new Date()): boolean {
  if (lease.state === 'expired' || lease.state === 'revoked' || lease.state === 'released') return true
  return new Date(lease.expiresAt) < now
}

export function getFencingToken(leaseId: string): FencingToken | undefined {
  return fencingTokens.get(leaseId)
}

export function clearLeases(): void {
  leases.clear()
  fencingTokens.clear()
}
