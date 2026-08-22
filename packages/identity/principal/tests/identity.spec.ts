import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createChain,
  extendChain,
  verifyInChain,
  assertAgentInChain,
  useToken,
  isTokenUsed,
  clearTokens,
  sameTenant,
  assertTenant,
  delegationDepth,
  isAnonymousDev,
  isAdmin,
  asTenantId,
  TenantBoundaryError,
  ForgedAgentIdError,
  ReplayedTokenError,

  type UserPrincipal,
  type AgentPrincipal,
  type AnonymousDevPrincipal,
} from '../src/index.ts'

const tenantA = asTenantId('tenant-a')
const tenantB = asTenantId('tenant-b')

const rootUser: UserPrincipal = {
  kind: 'user',
  id: 'user-1',
  tenantId: tenantA,
}

const agentP: AgentPrincipal = {
  kind: 'agent',
  id: 'agent-1',
  tenantId: tenantA,
  runId: 'run-1',
  delegatedBy: 'user-1',
  delegationDepth: 1,
}

const anonDev: AnonymousDevPrincipal = {
  kind: 'anonymous-dev',
  id: 'anon-1',
  tenantId: tenantA,
}

describe('P2-01 Principal/Tenant identity', () => {
  beforeEach(() => clearTokens())
  afterEach(() => clearTokens())

  describe('delegation chain', () => {
    it('creates a chain from a root principal', () => {
      const chain = createChain(rootUser)
      expect(chain.entries).toHaveLength(1)
      expect(chain.rootPrincipalId).toBe('user-1')
      expect(chain.currentPrincipalId).toBe('user-1')
      expect(chain.rootTenantId).toBe(tenantA)
    })

    it('extends chain with same-tenant delegation', () => {
      const chain = createChain(rootUser)
      const extended = extendChain(chain, agentP, 'subagent task')
      expect(extended.entries).toHaveLength(2)
      expect(extended.currentPrincipalId).toBe('agent-1')
      expect(extended.rootPrincipalId).toBe('user-1')
    })

    it('rejects cross-tenant delegation', () => {
      const chain = createChain(rootUser)
      const foreignAgent: AgentPrincipal = {
        ...agentP,
        tenantId: tenantB,
      }
      expect(() => extendChain(chain, foreignAgent)).toThrow(TenantBoundaryError)
    })

    it('tracks delegation depth', () => {
      const chain = createChain(rootUser)
      expect(delegationDepth(chain)).toBe(0)
      const extended = extendChain(chain, agentP)
      expect(delegationDepth(extended)).toBe(1)
    })
  })

  describe('forged agent ID detection', () => {
    it('verifies agent in chain', () => {
      const chain = createChain(rootUser)
      const extended = extendChain(chain, agentP)
      expect(verifyInChain(extended, 'agent-1')).toBe(true)
      expect(verifyInChain(extended, 'forged-agent')).toBe(false)
    })

    it('throws on forged agent ID', () => {
      const chain = createChain(rootUser)
      expect(() => assertAgentInChain(chain, 'forged-agent')).toThrow(ForgedAgentIdError)
    })
  })

  describe('replay token detection', () => {
    it('marks token as used', () => {
      useToken('token-1')
      expect(isTokenUsed('token-1')).toBe(true)
      expect(isTokenUsed('token-2')).toBe(false)
    })

    it('throws on replayed token', () => {
      useToken('token-1')
      expect(() => useToken('token-1')).toThrow(ReplayedTokenError)
    })
  })

  describe('tenant boundary enforcement', () => {
    it('same tenant check passes for same tenant', () => {
      const user1: UserPrincipal = { kind: 'user', id: 'u1', tenantId: tenantA }
      const user2: UserPrincipal = { kind: 'user', id: 'u2', tenantId: tenantA }
      expect(sameTenant(user1, user2)).toBe(true)
    })

    it('same tenant check fails for different tenant', () => {
      const user1: UserPrincipal = { kind: 'user', id: 'u1', tenantId: tenantA }
      const user2: UserPrincipal = { kind: 'user', id: 'u2', tenantId: tenantB }
      expect(sameTenant(user1, user2)).toBe(false)
    })

    it('assertTenant throws on cross-tenant', () => {
      expect(() => assertTenant(rootUser, tenantB)).toThrow(TenantBoundaryError)
    })

    it('assertTenant passes for same tenant', () => {
      expect(() => assertTenant(rootUser, tenantA)).not.toThrow()
    })
  })

  describe('anonymous dev principal', () => {
    it('isAnonymousDev returns true for anon-dev', () => {
      expect(isAnonymousDev(anonDev)).toBe(true)
      expect(isAnonymousDev(rootUser)).toBe(false)
    })

    it('isAdmin returns false for anon-dev', () => {
      expect(isAdmin(anonDev)).toBe(false)
      expect(isAdmin(rootUser)).toBe(true)
    })
  })

  describe('full delegation chain traceability', () => {
    it('can trace root user/tenant from any point in chain', () => {
      const chain = createChain(rootUser)
      const extended = extendChain(chain, agentP, 'subagent task')
      expect(extended.rootPrincipalId).toBe('user-1')
      expect(extended.rootTenantId).toBe(tenantA)
      expect(extended.currentPrincipalId).toBe('agent-1')
      expect(extended.entries).toHaveLength(2)
      expect(extended.entries[0]!.principalId).toBe('user-1')
      expect(extended.entries[1]!.principalId).toBe('agent-1')
    })
  })
})
