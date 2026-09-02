import { describe, expect, it } from 'vitest'
import {
  assertAgentDelegationValid,
  assertInChain,
  assertSameTenantId,
  createAdminServicePrincipal,
  createAdminUserPrincipal,
  createAgentPrincipal,
  createAnonymousDevPrincipal,
  createChain,
  createServicePrincipal,
  createUserPrincipal,
  currentPrincipal,
  currentTenantId,
  delegationDepth,
  extendChain,
  isAdminPrincipal,
  isAnonymousDev,
  isInChain,
  rootPrincipal,
  rootTenantId,
  sameTenant,
} from '../src/chain.ts'
import {
  ForgedPrincipalError,
  PrincipalId,
  RunId,
  TenantId,
  TenantMismatchError,
  type AgentPrincipal,
  type Principal,
} from '../src/types.ts'

const TENANT_A = TenantId('tenant-a')
const TENANT_B = TenantId('tenant-b')

describe('TenantId / RunId / PrincipalId branding', () => {
  it('brands a raw string as a TenantId without changing its value', () => {
    expect(String(TenantId('tenant-a'))).toBe('tenant-a')
  })

  it('brands a raw string as a RunId without changing its value', () => {
    expect(String(RunId('run-1'))).toBe('run-1')
  })

  it('brands a raw string as a PrincipalId without changing its value', () => {
    expect(String(PrincipalId('user-1'))).toBe('user-1')
  })
})

describe('principal construction', () => {
  it('creates a non-admin user principal', () => {
    const user = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    expect(user).toEqual({ kind: 'user', id: PrincipalId('u1'), tenantId: TENANT_A, isAdmin: false })
  })

  it('creates an admin user principal through a separate constructor', () => {
    const admin = createAdminUserPrincipal(PrincipalId('u1'), TENANT_A)
    expect(admin).toEqual({ kind: 'user', id: PrincipalId('u1'), tenantId: TENANT_A, isAdmin: true })
  })

  it('creates a non-admin service principal', () => {
    const service = createServicePrincipal(PrincipalId('svc1'), TENANT_A)
    expect(service).toEqual({ kind: 'service', id: PrincipalId('svc1'), tenantId: TENANT_A, isAdmin: false })
  })

  it('creates an admin service principal through a separate constructor', () => {
    const admin = createAdminServicePrincipal(PrincipalId('svc1'), TENANT_A)
    expect(admin).toEqual({ kind: 'service', id: PrincipalId('svc1'), tenantId: TENANT_A, isAdmin: true })
  })

  it('creates an agent principal with no isAdmin field', () => {
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, PrincipalId('u1'))
    expect(agent).toEqual({ kind: 'agent', id: PrincipalId('agent1'), tenantId: TENANT_A, delegatedBy: PrincipalId('u1') })
    expect('isAdmin' in agent).toBe(false)
  })

  it('creates an anonymous-dev principal with no isAdmin field', () => {
    const dev = createAnonymousDevPrincipal(PrincipalId('dev1'), TENANT_A)
    expect(dev).toEqual({ kind: 'anonymous-dev', id: PrincipalId('dev1'), tenantId: TENANT_A })
    expect('isAdmin' in dev).toBe(false)
  })
})

describe('createChain', () => {
  it('starts a chain with exactly one entry: the root principal', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    expect(chain.entries).toHaveLength(1)
    expect(chain.entries[0]).toEqual({ principal: root, delegatedAt: 1000 })
  })

  it('makes the root principal both the root and the current principal of a fresh chain', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    expect(rootPrincipal(chain)).toEqual(root)
    expect(currentPrincipal(chain)).toEqual(root)
  })
})

describe('extendChain', () => {
  it('appends a same-tenant principal as a new entry without mutating the original chain', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    const extended = extendChain(chain, agent, 2000)
    expect(chain.entries).toHaveLength(1)
    expect(extended.entries).toHaveLength(2)
    expect(extended.entries[1]).toEqual({ principal: agent, delegatedAt: 2000, reason: undefined })
  })

  it('rejects a cross-tenant principal with TenantMismatchError', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const foreignAgent = createAgentPrincipal(PrincipalId('agent1'), TENANT_B, root.id)
    expect(() => extendChain(chain, foreignAgent, 2000)).toThrow(TenantMismatchError)
  })

  it('increments delegationDepth by one for every extension', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    let chain = createChain(root, 1000)
    expect(delegationDepth(chain)).toBe(0)
    const agent1 = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    chain = extendChain(chain, agent1, 2000)
    expect(delegationDepth(chain)).toBe(1)
    const agent2 = createAgentPrincipal(PrincipalId('agent2'), TENANT_A, agent1.id)
    chain = extendChain(chain, agent2, 3000)
    expect(delegationDepth(chain)).toBe(2)
  })

  it('records the optional delegation reason on the new entry', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    const extended = extendChain(chain, agent, 2000, 'spawned to handle subtask')
    expect(extended.entries[1].reason).toBe('spawned to handle subtask')
  })
})

describe('rootPrincipal / currentPrincipal / rootTenantId / currentTenantId', () => {
  it('keeps rootPrincipal fixed across every extension', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    let chain = createChain(root, 1000)
    const agent1 = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    chain = extendChain(chain, agent1, 2000)
    const agent2 = createAgentPrincipal(PrincipalId('agent2'), TENANT_A, agent1.id)
    chain = extendChain(chain, agent2, 3000)
    expect(rootPrincipal(chain)).toEqual(root)
  })

  it('advances currentPrincipal to the most recently delegated principal', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    let chain = createChain(root, 1000)
    const agent1 = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    chain = extendChain(chain, agent1, 2000)
    expect(currentPrincipal(chain)).toEqual(agent1)
  })

  it('keeps rootTenantId equal to the root principal tenant across every extension', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    let chain = createChain(root, 1000)
    const agent1 = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    chain = extendChain(chain, agent1, 2000)
    expect(rootTenantId(chain)).toBe(TENANT_A)
    expect(currentTenantId(chain)).toBe(TENANT_A)
  })
})

describe('isInChain / assertInChain', () => {
  it('finds a principal id that was delegated earlier in the chain', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    expect(isInChain(chain, root.id)).toBe(true)
  })

  it('does not find a principal id that never appears in the chain', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    expect(isInChain(chain, PrincipalId('nobody'))).toBe(false)
  })

  it('throws ForgedPrincipalError for a principal id absent from the chain', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    expect(() => assertInChain(chain, PrincipalId('nobody'))).toThrow(ForgedPrincipalError)
  })
})

describe('assertAgentDelegationValid', () => {
  it('accepts an agent principal that is the chain current entry and whose delegatedBy is in the chain', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    const extended = extendChain(chain, agent, 2000)
    expect(() => assertAgentDelegationValid(extended, agent)).not.toThrow()
  })

  it('rejects an agent whose id is not the chain current principal', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const forgedAgent: AgentPrincipal = createAgentPrincipal(PrincipalId('impostor'), TENANT_A, root.id)
    expect(() => assertAgentDelegationValid(chain, forgedAgent)).toThrow(ForgedPrincipalError)
  })

  it('rejects an agent whose delegatedBy does not appear in the chain', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, PrincipalId('nobody'))
    const extended = extendChain(chain, agent, 2000)
    expect(() => assertAgentDelegationValid(extended, agent)).toThrow(ForgedPrincipalError)
  })

  it('rejects an agent whose tenant differs from the chain tenant', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const legitAgent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    const extended = extendChain(chain, legitAgent, 2000)
    // Same id as the chain's actual current entry, but a forged tenantId claim.
    const claimedWithForgedTenant: AgentPrincipal = { ...legitAgent, tenantId: TENANT_B }
    expect(() => assertAgentDelegationValid(extended, claimedWithForgedTenant)).toThrow(TenantMismatchError)
  })
})

describe('sameTenant / assertSameTenantId', () => {
  it('reports two principals in the same tenant as same-tenant', () => {
    const a = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const b = createServicePrincipal(PrincipalId('svc1'), TENANT_A)
    expect(sameTenant(a, b)).toBe(true)
  })

  it('reports two principals in different tenants as not same-tenant', () => {
    const a = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const b = createServicePrincipal(PrincipalId('svc1'), TENANT_B)
    expect(sameTenant(a, b)).toBe(false)
  })

  it('throws TenantMismatchError when asserted tenant ids differ', () => {
    expect(() => assertSameTenantId(TENANT_A, TENANT_B)).toThrow(TenantMismatchError)
    expect(() => assertSameTenantId(TENANT_A, TENANT_A)).not.toThrow()
  })
})

describe('isAnonymousDev / isAdminPrincipal', () => {
  it('identifies an anonymous-dev principal as anonymous-dev', () => {
    const dev = createAnonymousDevPrincipal(PrincipalId('dev1'), TENANT_A)
    expect(isAnonymousDev(dev)).toBe(true)
  })

  it('never treats an anonymous-dev principal as admin', () => {
    const dev = createAnonymousDevPrincipal(PrincipalId('dev1'), TENANT_A)
    expect(isAdminPrincipal(dev)).toBe(false)
  })

  it('never treats an agent principal as admin', () => {
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, PrincipalId('u1'))
    expect(isAdminPrincipal(agent)).toBe(false)
  })

  it('treats a user principal as admin only when isAdmin is true', () => {
    expect(isAdminPrincipal(createUserPrincipal(PrincipalId('u1'), TENANT_A))).toBe(false)
    expect(isAdminPrincipal(createAdminUserPrincipal(PrincipalId('u1'), TENANT_A))).toBe(true)
  })

  it('treats a service principal as admin only when isAdmin is true', () => {
    expect(isAdminPrincipal(createServicePrincipal(PrincipalId('svc1'), TENANT_A))).toBe(false)
    expect(isAdminPrincipal(createAdminServicePrincipal(PrincipalId('svc1'), TENANT_A))).toBe(true)
  })

  it('does not derive admin from the absence of anonymous-dev — a plain non-admin user principal is not admin', () => {
    const notDevButNotAdminEither = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    expect(isAnonymousDev(notDevButNotAdminEither)).toBe(false)
    expect(isAdminPrincipal(notDevButNotAdminEither)).toBe(false)
  })

  it('throws when a value outside the closed PrincipalKind union escapes to isAdminPrincipal', () => {
    const rogue = { kind: 'rogue-kind', id: PrincipalId('x'), tenantId: TENANT_A } as unknown as Principal
    expect(() => isAdminPrincipal(rogue)).toThrow('unreachable variant in isAdminPrincipal')
  })
})

describe('TenantMismatchError / ForgedPrincipalError', () => {
  it('carries the attempted and actual tenant ids on TenantMismatchError', () => {
    try {
      assertSameTenantId(TENANT_B, TENANT_A)
      expect.unreachable('assertSameTenantId must throw on mismatched tenants')
    } catch (error) {
      expect(error).toBeInstanceOf(TenantMismatchError)
      const mismatch = error as TenantMismatchError
      expect(mismatch.attemptedTenantId).toBe(TENANT_B)
      expect(mismatch.actualTenantId).toBe(TENANT_A)
    }
  })

  it('carries the claimed principal id on ForgedPrincipalError', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    try {
      assertInChain(chain, PrincipalId('nobody'))
      expect.unreachable('assertInChain must throw for an absent principal id')
    } catch (error) {
      expect(error).toBeInstanceOf(ForgedPrincipalError)
      expect((error as ForgedPrincipalError).claimedPrincipalId).toBe(PrincipalId('nobody'))
    }
  })
})
