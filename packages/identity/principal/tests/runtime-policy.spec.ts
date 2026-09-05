import { describe, expect, it } from 'vitest'
import { assertRuntimeTenantPolicy } from '../src/index.ts'
import {
  createAgentPrincipal,
  createChain,
  createUserPrincipal,
  currentPrincipal,
  extendChain,
} from '../src/chain.ts'
import {
  PrincipalId,
  RunId,
  TenantId,
  TenantMismatchError,
  type DelegationChain,
  type IdentityContext,
} from '../src/types.ts'

const TENANT_A = TenantId('tenant-a')
const TENANT_B = TenantId('tenant-b')

function identityFor(chain: DelegationChain): IdentityContext {
  return { principal: currentPrincipal(chain), runId: RunId('run-1'), chain }
}

describe('assertRuntimeTenantPolicy (runtime-policy layer, first100 P2-01 acceptance[1])', () => {
  it('accepts a live identity whose actual tenant matches the request-claimed tenant', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const identity = identityFor(createChain(root, 1000))
    expect(() =>{  assertRuntimeTenantPolicy(identity, TENANT_A) }).not.toThrow()
  })

  it('rejects a live identity whose actual tenant differs from the request-claimed tenant, throwing TenantMismatchError', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const identity = identityFor(createChain(root, 1000))
    expect(() =>{  assertRuntimeTenantPolicy(identity, TENANT_B) }).toThrow(TenantMismatchError)
  })

  it('checks the tenant of the chain\'s currently-acting principal, not necessarily the root, for a delegated identity', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    const extended = extendChain(chain, agent, 2000)
    const identity = identityFor(extended)
    expect(() =>{  assertRuntimeTenantPolicy(identity, TENANT_A) }).not.toThrow()
    expect(() =>{  assertRuntimeTenantPolicy(identity, TENANT_B) }).toThrow(TenantMismatchError)
  })

  it('rejects cross-tenant confusion at the runtime-policy layer even when the identity\'s own chain construction never saw a mismatch -- proving this is a genuinely distinct check from extendChain\'s construction-time TenantMismatchError', () => {
    // The chain itself is built entirely within tenant-a; extendChain never
    // rejects anything here because every hop it ever saw shared one tenant.
    // requestedTenantId (tenant-b) never went through chain construction at
    // all -- it is supplied independently, the way a live tool argument or
    // resource path would be -- so only assertRuntimeTenantPolicy, invoked
    // separately against the already-complete identity, can catch it.
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const chain = createChain(root, 1000)
    const agent = createAgentPrincipal(PrincipalId('agent1'), TENANT_A, root.id)
    const extended = extendChain(chain, agent, 2000)
    expect(extended.entries).toHaveLength(2)
    const identity = identityFor(extended)
    expect(() =>{  assertRuntimeTenantPolicy(identity, TENANT_B) }).toThrow(TenantMismatchError)
  })

  it('carries the attempted and actual tenant ids on the thrown TenantMismatchError', () => {
    const root = createUserPrincipal(PrincipalId('u1'), TENANT_A)
    const identity = identityFor(createChain(root, 1000))
    try {
      assertRuntimeTenantPolicy(identity, TENANT_B)
      expect.unreachable('assertRuntimeTenantPolicy must throw on mismatched tenants')
    } catch (error) {
      expect(error).toBeInstanceOf(TenantMismatchError)
      const mismatch = error as TenantMismatchError
      expect(mismatch.attemptedTenantId).toBe(TENANT_B)
      expect(mismatch.actualTenantId).toBe(TENANT_A)
    }
  })
})
