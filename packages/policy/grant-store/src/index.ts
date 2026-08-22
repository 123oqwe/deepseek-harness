import { createHash } from 'node:crypto'
import type { Grant, GrantScope, GrantMatchResult } from './types.ts'
import { matchGrant } from './match.ts'

export type { Grant, GrantScope, GrantStatus, GrantMatchResult } from './types.ts'
export { matchGrant } from './match.ts'

export class GrantStore {
  private readonly grants = new Map<string, Grant>()

  issue(input: Omit<Grant, 'digest' | 'issuedAt' | 'status'> & { issuedAt?: number }): Grant {
    const issuedAt = input.issuedAt ?? Date.now()
    const content = { ...input, issuedAt }
    const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex')
    const grant: Grant = { ...content, digest }
    this.grants.set(grant.id, grant)
    return grant
  }

  revoke(grantId: string, revokedAt: number): { revoked: boolean; reason: string } {
    const grant = this.grants.get(grantId)
    if (!grant) return { revoked: false, reason: 'grant not found' }
    if (grant.revokedAt !== undefined) return { revoked: false, reason: 'already revoked' }
    const updated: Grant = { ...grant, revokedAt }
    this.grants.set(grantId, updated)
    return { revoked: true, reason: 'revoked' }
  }

  isExpired(grant: Grant, now: number): boolean {
    return now > grant.expiresAt
  }

  isRevoked(grant: Grant): boolean {
    return grant.revokedAt !== undefined
  }

  isActive(grant: Grant, now: number): boolean {
    return !this.isRevoked(grant) && !this.isExpired(grant, now)
  }

  match(
    request: { principal: string; resource: string; scope: GrantScope; amount?: number; destination?: string },
    now: number,
  ): GrantMatchResult {
    const active = Array.from(this.grants.values()).filter(g => this.isActive(g, now))
    return matchGrant(active, request, now)
  }

  revokeDescendants(parentGrantId: string, now: number): { revoked: string[] } {
    const revoked: string[] = []
    for (const [id, grant] of this.grants) {
      if (grant.parentGrantId === parentGrantId && grant.revokedAt === undefined) {
        this.revoke(id, now)
        revoked.push(id)
        // Recursively revoke children
        const childResult = this.revokeDescendants(id, now)
        revoked.push(...childResult.revoked)
      }
    }
    return { revoked }
  }

  get(grantId: string): Grant | undefined {
    return this.grants.get(grantId)
  }

  list(): readonly Grant[] {
    return Array.from(this.grants.values())
  }
}
