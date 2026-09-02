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
  type ServicePrincipal,
  type UserPrincipal,
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
  it('creates a non-admin user principal with no adminGrant field', () => {
    const user = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    expect(user).toEqual({ kind: 'user', id: PrincipalId('u1'), tenantId: TENANT_A })
    expect('adminGrant' in user).toBe(false)
  })

  it('creates an admin user principal through a separate constructor', () => {
    const admin = createAdminUserPrincipal(PrincipalId('u1'), TENANT_A)
    expect(admin.kind).toBe('user')
    expect(admin.id).toBe(PrincipalId('u1'))
    expect(admin.tenantId).toBe(TENANT_A)
    expect(admin.adminGrant).toBeDefined()
    expect(isAdminPrincipal(admin)).toBe(true)
  })

  it('creates a non-admin service principal with no adminGrant field', () => {
    const service = createServicePrincipal(PrincipalId('svc1'), TENANT_A)
    expect(service).toEqual({ kind: 'service', id: PrincipalId('svc1'), tenantId: TENANT_A })
    expect('adminGrant' in service).toBe(false)
  })

  it('creates an admin service principal through a separate constructor', () => {
    const admin = createAdminServicePrincipal(PrincipalId('svc1'), TENANT_A)
    expect(admin.kind).toBe('service')
    expect(admin.id).toBe(PrincipalId('svc1'))
    expect(admin.tenantId).toBe(TENANT_A)
    expect(admin.adminGrant).toBeDefined()
    expect(isAdminPrincipal(admin)).toBe(true)
  })

  it('creates an agent principal with no adminGrant field', () => {
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, PrincipalId('u1'))
    expect(agent).toEqual({ kind: 'agent', id: PrincipalId('agent1'), tenantId: TENANT_A, delegatedBy: PrincipalId('u1') })
    expect('adminGrant' in agent).toBe(false)
  })

  it('creates an anonymous-dev principal with no adminGrant field', () => {
    const dev = createAnonymousDevPrincipal(PrincipalId('dev1'), TENANT_A)
    expect(dev).toEqual({ kind: 'anonymous-dev', id: PrincipalId('dev1'), tenantId: TENANT_A })
    expect('adminGrant' in dev).toBe(false)
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
    expect(extended.entries[1]?.reason).toBe('spawned to handle subtask')
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

  it('treats a user principal as admin only when it carries a genuine adminGrant', () => {
    expect(isAdminPrincipal(createUserPrincipal(PrincipalId('u1'), TENANT_A))).toBe(false)
    expect(isAdminPrincipal(createAdminUserPrincipal(PrincipalId('u1'), TENANT_A))).toBe(true)
  })

  it('treats a service principal as admin only when it carries a genuine adminGrant', () => {
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

  it('rejects the exact reviewer bypass shape: a plain UserPrincipal object literal with isAdmin: true set directly, no createAdminUserPrincipal import, is never treated as admin', () => {
    // The original Finding 1 repro: `isAdmin` no longer exists on UserPrincipal
    // at all, so this shape only reaches isAdminPrincipal by routing around
    // the type system (as a real forged/deserialized value would) — the cast
    // is the point of the test, not an oversight.
    const forged = {
      kind: 'user',
      id: PrincipalId('attacker'),
      tenantId: TENANT_A,
      isAdmin: true,
    } as unknown as UserPrincipal
    expect(isAdminPrincipal(forged)).toBe(false)
  })

  it('rejects a hand-built UserPrincipal whose adminGrant is a plain object literal, not a token minted by createAdminUserPrincipal', () => {
    const forged = {
      kind: 'user',
      id: PrincipalId('attacker'),
      tenantId: TENANT_A,
      adminGrant: {},
    } as unknown as UserPrincipal
    expect(isAdminPrincipal(forged)).toBe(false)
  })

  it('rejects an admin claim reconstructed from JSON.parse: a deserialized object can never be a member of the real admin-grant registry', () => {
    const parsed = JSON.parse(
      '{"kind":"user","id":"attacker","tenantId":"tenant-a","adminGrant":{}}',
    ) as unknown as UserPrincipal
    expect(isAdminPrincipal(parsed)).toBe(false)
  })

  it('rejects a genuine adminGrant token reused via object literal on a principal with a different id and tenantId than it was minted for', () => {
    // Second-round Reviewer's exact repro: a real, already-registered token
    // reattached to a completely different identity.
    const legitAdmin = createAdminUserPrincipal(PrincipalId('legit-admin'), TENANT_A)
    const spoofed: UserPrincipal = {
      kind: 'user',
      id: PrincipalId('attacker'),
      tenantId: TENANT_B,
      adminGrant: legitAdmin.adminGrant!,
    }
    expect(isAdminPrincipal(spoofed)).toBe(false)
  })

  it('rejects a genuine adminGrant token reused via object literal on an attacker-constructed principal whose id and tenantId exactly match the real admin it was minted for', () => {
    // PrincipalId/TenantId (./types.ts) brand any string with zero runtime
    // gating, so an attacker who has merely observed a real admin's id and
    // tenantId (routinely non-secret — logged, shown in URLs/UI) can
    // reconstruct them exactly; only object-identity binding (not id/tenantId
    // value equality) closes this, because the reconstructed object is a
    // different object from the one the grant was bound to at mint time.
    const legitAdmin = createAdminUserPrincipal(PrincipalId('legit-admin'), TENANT_A)
    const impersonator: UserPrincipal = {
      kind: 'user',
      id: PrincipalId('legit-admin'),
      tenantId: TENANT_A,
      adminGrant: legitAdmin.adminGrant!,
    }
    expect(impersonator).not.toBe(legitAdmin)
    expect(isAdminPrincipal(impersonator)).toBe(false)
  })

  it('rejects a genuine adminGrant token reused via object literal on a different-kind principal (service) carrying the admin user principal\'s own id and tenantId', () => {
    const legitAdmin = createAdminUserPrincipal(PrincipalId('legit-admin'), TENANT_A)
    const crossKind: ServicePrincipal = {
      kind: 'service',
      id: PrincipalId('legit-admin'),
      tenantId: TENANT_A,
      adminGrant: legitAdmin.adminGrant!,
    }
    expect(isAdminPrincipal(crossKind)).toBe(false)
  })

  it('still recognizes a real admin principal as admin when checked as itself, unmodified', () => {
    const admin = createAdminUserPrincipal(PrincipalId('real-admin'), TENANT_A)
    expect(isAdminPrincipal(admin)).toBe(true)
  })

  // Deliberate, disclosed fail-closed boundary (see chain.ts's adminGrantOwners
  // doc): binding by object identity means a real admin principal reconstructed
  // across a serialization boundary is never the original reference, so it is
  // correctly rejected here even though every field is genuine. A later epic
  // rehydrating admin principals across a process/wire boundary must establish
  // authority via real Trust Kernel signature verification at that rehydration
  // point -- never by trusting deserialized id/tenantId fields, and never by
  // re-minting an AdminGrant based on them.
  it('fails closed: a real admin principal round-tripped through structuredClone is never recognized as admin, since the clone is a new object never registered in adminGrantOwners', () => {
    const admin = createAdminUserPrincipal(PrincipalId('real-admin'), TENANT_A)
    const cloned = structuredClone(admin)
    expect(cloned).not.toBe(admin)
    expect(isAdminPrincipal(cloned)).toBe(false)
  })

  it('fails closed: a real admin principal round-tripped through JSON.stringify/JSON.parse is never recognized as admin, since the rehydrated object is new and was never registered in adminGrantOwners', () => {
    const admin = createAdminUserPrincipal(PrincipalId('real-admin'), TENANT_A)
    const rehydrated = JSON.parse(JSON.stringify(admin)) as UserPrincipal
    expect(rehydrated).not.toBe(admin)
    expect(isAdminPrincipal(rehydrated)).toBe(false)
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
