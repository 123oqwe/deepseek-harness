/**
 * P6-02 Usage stage: a merge across a scope boundary must be asked for.
 *
 * This file exists because the pre-flight freeze-target list (BLOCKED-095)
 * asked where the U stage's freeze would hang, and found that U declares only
 * source files and no test file at all. Without deciding then, these titles
 * would have landed in record.spec.ts beside the C and F sets, giving one file
 * three disjoint frozen groups for no reason.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { decideCrossScopeMerge } from '../src/record.ts'
import type { TenantId } from '@deepseek-ai/dsh-principal'
import type { CrossScopeMergeAuthorization, MemoryScope } from '../src/types.ts'

const TENANT_A = brandString<TenantId>('tenant-a')
const TENANT_B = brandString<TenantId>('tenant-b')

function scope(tenantId: TenantId, sessionId?: string): MemoryScope {
  return sessionId === undefined ? { tenantId } : { tenantId, sessionId }
}

function authorization(from: MemoryScope, into: MemoryScope): CrossScopeMergeAuthorization {
  return { from, into, authorizedBy: 'operator-1' }
}

describe('P6-02 acceptance[2]: a merge within one scope needs no authorization', () => {
  it('permits it and reports that no boundary was crossed', () => {
    // Reporting `crossesScope` lets an audit tell the two apart without
    // re-deriving it; without the flag every merge would record identically.
    expect(decideCrossScopeMerge(scope(TENANT_A), scope(TENANT_A)))
      .toEqual({ permitted: true, crossesScope: false })
  })

  it('treats the same tenant and session as one scope', () => {
    expect(decideCrossScopeMerge(scope(TENANT_A, 's1'), scope(TENANT_A, 's1')))
      .toEqual({ permitted: true, crossesScope: false })
  })
})

describe('P6-02 acceptance[2]: crossing a boundary is refused unless asked for', () => {
  it('refuses a cross-tenant merge with no authorization', () => {
    expect(decideCrossScopeMerge(scope(TENANT_A), scope(TENANT_B)))
      .toEqual({ permitted: false, reason: 'cross-tenant-not-authorized' })
  })

  it('refuses a cross-session merge with a DIFFERENT reason from a cross-tenant one', () => {
    // Crossing tenants moves data between customers; crossing sessions moves
    // it within one. One message for both would make an operator read events
    // of very different severity the same way.
    expect(decideCrossScopeMerge(scope(TENANT_A, 's1'), scope(TENANT_A, 's2')))
      .toEqual({ permitted: false, reason: 'cross-session-not-authorized' })
  })

  it('permits a cross-tenant merge that names both endpoints', () => {
    const from = scope(TENANT_A)
    const into = scope(TENANT_B)

    expect(decideCrossScopeMerge(from, into, authorization(from, into)))
      .toEqual({ permitted: true, crossesScope: true })
  })

  it('refuses an authorization issued for a different destination', () => {
    // An authorization naming only where records land would permit merging
    // into it from anywhere; naming the pair is what stops one approval from
    // covering every later merge.
    const from = scope(TENANT_A)
    expect(decideCrossScopeMerge(from, scope(TENANT_B), authorization(from, scope(brandString<TenantId>('tenant-c')))))
      .toEqual({ permitted: false, reason: 'authorization-scope-mismatch' })
  })

  it('refuses an authorization issued for a different source', () => {
    const into = scope(TENANT_B)
    expect(decideCrossScopeMerge(scope(TENANT_A), into, authorization(scope(brandString<TenantId>('tenant-c')), into)))
      .toEqual({ permitted: false, reason: 'authorization-scope-mismatch' })
  })

  it('does not let a session-scoped authorization cover a tenant-wide merge', () => {
    // `{tenant-a}` and `{tenant-a, s1}` are different scopes, so an
    // authorization for one does not authorize the other.
    const into = scope(TENANT_B)
    expect(decideCrossScopeMerge(scope(TENANT_A), into, authorization(scope(TENANT_A, 's1'), into)))
      .toEqual({ permitted: false, reason: 'authorization-scope-mismatch' })
  })
})
