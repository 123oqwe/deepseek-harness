import type { Grant, GrantMatchResult, GrantScope } from './types.ts'

export function matchGrant(
  grants: readonly Grant[],
  request: { principal: string; resource: string; scope: GrantScope; amount?: number; destination?: string },
  now: number,
): GrantMatchResult {
  for (const grant of grants) {
    if (grant.revokedAt !== undefined) continue
    if (now > grant.expiresAt) continue

    if (grant.principal !== request.principal) continue
    if (!matchResource(grant.resource, request.resource)) continue
    if (!scopeSatisfies(grant.scope, request.scope)) continue

    const c = grant.constraints
    if (c?.maxAmount !== undefined && request.amount !== undefined) {
      if (request.amount > c.maxAmount) continue
    }

    if (c?.allowedDestinations !== undefined && request.destination !== undefined) {
      if (!c.allowedDestinations.includes(request.destination) &&
          !c.allowedDestinations.includes('*')) continue
    }

    return { matched: true, reason: 'matched', grantId: grant.id }
  }
  return { matched: false, reason: 'no matching active grant' }
}

function matchResource(pattern: string, resource: string): boolean {
  if (pattern === '*') return true
  if (pattern === resource) return true
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return resource.startsWith(prefix + '/') || resource === prefix
  }
  return false
}

function scopeSatisfies(granted: GrantScope, requested: GrantScope): boolean {
  const hierarchy: Record<GrantScope, number> = { read: 1, write: 2, execute: 3, admin: 4 }
  return hierarchy[granted] >= hierarchy[requested]
}
