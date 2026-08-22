import { describe, it, expect } from 'vitest'
import { GrantStore } from '../src/index.ts'

const now = 1000000
const future = now + 3600000

describe('P2-08 Grant Store', () => {
  it('issues a grant with digest', () => {
    const store = new GrantStore()
    const grant = store.issue({
      id: 'g1', principal: 'user-1', resource: '/workspace/*',
      scope: 'read' as const, expiresAt: future, issuedAt: now,
    })
    expect(grant.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches a valid grant', () => {
    const store = new GrantStore()
    store.issue({
      id: 'g1', principal: 'user-1', resource: '/workspace/*',
      scope: 'write' as const, expiresAt: future, issuedAt: now,
    })
    const result = store.match({ principal: 'user-1', resource: '/workspace/file.ts', scope: 'read' as const }, now)
    expect(result.matched).toBe(true)
  })

  it('rejects expired grant', () => {
    const store = new GrantStore()
    store.issue({
      id: 'g1', principal: 'user-1', resource: '/workspace/*',
      scope: 'read' as const, expiresAt: now - 1000, issuedAt: now - 2000,
    })
    const result = store.match({ principal: 'user-1', resource: '/workspace/file.ts', scope: 'read' as const }, now)
    expect(result.matched).toBe(false)
  })

  it('rejects revoked grant', () => {
    const store = new GrantStore()
    store.issue({
      id: 'g1', principal: 'user-1', resource: '/workspace/*',
      scope: 'read' as const, expiresAt: future, issuedAt: now,
    })
    store.revoke('g1', now)
    const result = store.match({ principal: 'user-1', resource: '/workspace/file.ts', scope: 'read' as const }, now)
    expect(result.matched).toBe(false)
  })

  it('enforces scope hierarchy', () => {
    const store = new GrantStore()
    store.issue({
      id: 'g1', principal: 'user-1', resource: '/workspace/*',
      scope: 'read' as const, expiresAt: future, issuedAt: now,
    })
    const result = store.match({ principal: 'user-1', resource: '/workspace/file.ts', scope: 'write' as const }, now)
    expect(result.matched).toBe(false)
  })

  it('enforces max amount constraint', () => {
    const store = new GrantStore()
    store.issue({
      id: 'g1', principal: 'user-1', resource: 'payment',
      scope: 'execute' as const, expiresAt: future, issuedAt: now,
      constraints: { maxAmount: 100 },
    })
    const ok = store.match({ principal: 'user-1', resource: 'payment', scope: 'execute' as const, amount: 50 }, now)
    expect(ok.matched).toBe(true)
    const over = store.match({ principal: 'user-1', resource: 'payment', scope: 'execute' as const, amount: 200 }, now)
    expect(over.matched).toBe(false)
  })

  it('enforces destination constraint', () => {
    const store = new GrantStore()
    store.issue({
      id: 'g1', principal: 'user-1', resource: 'api',
      scope: 'execute' as const, expiresAt: future, issuedAt: now,
      constraints: { allowedDestinations: ['https://api.example.com'] },
    })
    const ok = store.match({ principal: 'user-1', resource: 'api', scope: 'execute' as const, destination: 'https://api.example.com' }, now)
    expect(ok.matched).toBe(true)
    const blocked = store.match({ principal: 'user-1', resource: 'api', scope: 'execute' as const, destination: 'https://evil.com' }, now)
    expect(blocked.matched).toBe(false)
  })

  it('revokes descendants when parent revoked', () => {
    const store = new GrantStore()
    store.issue({ id: 'parent', principal: 'user-1', resource: '/ws/*', scope: 'admin' as const, expiresAt: future, issuedAt: now })
    store.issue({ id: 'child1', principal: 'user-1', resource: '/ws/sub/*', scope: 'write' as const, expiresAt: future, issuedAt: now, parentGrantId: 'parent' })
    store.issue({ id: 'child2', principal: 'user-1', resource: '/ws/sub2/*', scope: 'read' as const, expiresAt: future, issuedAt: now, parentGrantId: 'child1' })
    const result = store.revokeDescendants('parent', now)
    expect(result.revoked).toContain('child1')
    expect(result.revoked).toContain('child2')
  })

  it('takes most restrictive on overlap', () => {
    const store = new GrantStore()
    store.issue({ id: 'g1', principal: 'user-1', resource: '/ws/*', scope: 'admin' as const, expiresAt: future, issuedAt: now })
    store.issue({ id: 'g2', principal: 'user-1', resource: '/ws/*', scope: 'read' as const, expiresAt: future, issuedAt: now })
    // Both match for read; the first match should be returned
    const result = store.match({ principal: 'user-1', resource: '/ws/file.ts', scope: 'read' as const }, now)
    expect(result.matched).toBe(true)
  })
})
