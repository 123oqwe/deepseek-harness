import type { AuthenticatedPrincipal, AuthDecision, Role, ApiScope } from './types.ts'

export type { AuthenticatedPrincipal, AuthDecision, Role, ApiScope } from './types.ts'

const ROLE_SCOPES: Record<Role, ApiScope[]> = {
  admin: ['run:read', 'run:write', 'action:read', 'action:write', 'approval:read', 'approval:write', 'artifact:read', 'artifact:write', 'world:read', 'world:write'],
  operator: ['run:read', 'run:write', 'action:read', 'action:write', 'approval:read', 'artifact:read', 'world:read'],
  viewer: ['run:read', 'action:read', 'approval:read', 'artifact:read', 'world:read'],
  agent: ['run:write', 'action:write', 'artifact:write'],
}

export class AuthManager {
  private principals = new Map<string, AuthenticatedPrincipal>()

  authenticate(principalId: string, tenantId: string, roles: Role[]): AuthenticatedPrincipal {
    // eslint-disable-next-line no-unnecessary-condition
    const scopes = roles.flatMap(r => ROLE_SCOPES[r] ?? [])
    const principal: AuthenticatedPrincipal = {
      principalId, tenantId, roles, scopes, authenticated: true,
    }
    this.principals.set(principalId, principal)
    return principal
  }

  getPrincipal(principalId: string): AuthenticatedPrincipal | undefined {
    return this.principals.get(principalId)
  }

  authorize(
    principalId: string,
    scope: ApiScope,
    resourceTenantId: string,
  ): AuthDecision {
    const principal = this.principals.get(principalId)
    if (!principal || !principal.authenticated) {
      return { allowed: false, reason: 'Not authenticated', principalId, scope, resourceTenantId }
    }
    if (principal.tenantId !== resourceTenantId) {
      return { allowed: false, reason: 'Cross-tenant access denied', principalId, scope, resourceTenantId }
    }
    if (!principal.scopes.includes(scope)) {
      return { allowed: false, reason: `Scope not granted: ${scope}`, principalId, scope, resourceTenantId }
    }
    return { allowed: true, reason: 'Authorized', principalId, scope, resourceTenantId }
  }

  checkRole(principalId: string, requiredRole: Role): boolean {
    const principal = this.principals.get(principalId)
    if (!principal) return false
    const hierarchy: Role[] = ['viewer', 'agent', 'operator', 'admin']
    return hierarchy.indexOf(principal.roles[0] ?? 'viewer') >= hierarchy.indexOf(requiredRole)
  }

  isCrossTenant(principalId: string, targetTenantId: string): boolean {
    const principal = this.principals.get(principalId)
    if (!principal) return true
    return principal.tenantId !== targetTenantId
  }

  clear(): void {
    this.principals.clear()
  }
}
