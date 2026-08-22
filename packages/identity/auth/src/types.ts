export type Role = 'admin' | 'operator' | 'viewer' | 'agent'

export type ApiScope = 'run:read' | 'run:write' | 'action:read' | 'action:write' | 'approval:read' | 'approval:write' | 'artifact:read' | 'artifact:write' | 'world:read' | 'world:write'

export interface AuthenticatedPrincipal {
  readonly principalId: string
  readonly tenantId: string
  readonly roles: readonly Role[]
  readonly scopes: readonly ApiScope[]
  readonly authenticated: boolean
}

export interface AuthDecision {
  readonly allowed: boolean
  readonly reason: string
  readonly principalId: string
  readonly scope: ApiScope
  readonly resourceTenantId: string
}
