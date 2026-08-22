import { randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SecretLease, SecretLeaseId, CredentialRef } from './types.ts'

const leases = new Map<string, SecretLease>()

function asCredentialRef(s: string): CredentialRef {
  return s as Branded<'CredentialRef'>
}

function asLeaseId(s: string): SecretLeaseId {
  return s as Branded<'SecretLeaseId'>
}

export function issueLease(opts: {
  credentialRef: string
  principalId: string
  actionManifestDigest: string
  worldId: string
  purpose: string
  ttlSeconds: number
  injectionMethod: SecretLease['injectionMethod']
}): SecretLease {
  const lease: SecretLease = {
    id: asLeaseId(randomUUID()),
    credentialRef: asCredentialRef(opts.credentialRef),
    principalId: opts.principalId,
    actionManifestDigest: opts.actionManifestDigest,
    worldId: opts.worldId,
    purpose: opts.purpose,
    expiry: new Date(Date.now() + opts.ttlSeconds * 1000).toISOString(),
    issuedAt: new Date().toISOString(),
    revoked: false,
    injectionMethod: opts.injectionMethod,
  }
  leases.set(String(lease.id), lease)
  return lease
}

export function revokeLease(leaseId: string): void {
  const lease = leases.get(leaseId)
  if (lease) {
    leases.set(leaseId, { ...lease, revoked: true })
  }
}

export function getLease(leaseId: string): SecretLease | undefined {
  return leases.get(leaseId)
}

export function isExpired(lease: SecretLease, now: Date = new Date()): boolean {
  return lease.revoked || new Date(lease.expiry) < now
}

export function getActiveLeases(): SecretLease[] {
  const now = new Date()
  return Array.from(leases.values()).filter(l => !isExpired(l, now))
}

export function revokeAllForWorld(worldId: string): number {
  let count = 0
  for (const [id, lease] of leases) {
    if (lease.worldId === worldId && !lease.revoked) {
      leases.set(id, { ...lease, revoked: true })
      count++
    }
  }
  return count
}

export function clearLeases(): void {
  leases.clear()
}
