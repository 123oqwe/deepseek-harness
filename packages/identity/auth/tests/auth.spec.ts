import { describe, it, expect, beforeEach } from 'vitest'
import { AuthManager } from '../src/index.ts'

describe('P8-06 Auth & Tenant Boundary', () => {
  let auth: AuthManager

  beforeEach(() => { auth = new AuthManager() })

  it('authenticates a principal with roles and scopes', () => {
    const p = auth.authenticate('user-1', 't1', ['admin'])
    expect(p.authenticated).toBe(true)
    expect(p.scopes).toContain('run:write')
  })

  it('authorizes within tenant with correct scope', () => {
    auth.authenticate('user-1', 't1', ['operator'])
    const decision = auth.authorize('user-1', 'run:write', 't1')
    expect(decision.allowed).toBe(true)
  })

  it('denies cross-tenant access', () => {
    auth.authenticate('user-1', 't1', ['admin'])
    const decision = auth.authorize('user-1', 'run:read', 't2')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('Cross-tenant')
  })

  it('denies unauthenticated principal', () => {
    const decision = auth.authorize('unknown', 'run:read', 't1')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('Not authenticated')
  })

  it('denies scope not granted', () => {
    auth.authenticate('user-1', 't1', ['viewer'])
    const decision = auth.authorize('user-1', 'run:write', 't1')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('Scope not granted')
  })

  it('viewer role has read-only scopes', () => {
    auth.authenticate('user-1', 't1', ['viewer'])
    expect(auth.authorize('user-1', 'run:read', 't1').allowed).toBe(true)
    expect(auth.authorize('user-1', 'run:write', 't1').allowed).toBe(false)
  })

  it('agent role has write scopes', () => {
    auth.authenticate('agent-1', 't1', ['agent'])
    expect(auth.authorize('agent-1', 'run:write', 't1').allowed).toBe(true)
    expect(auth.authorize('agent-1', 'run:read', 't1').allowed).toBe(false)
  })

  it('checkRole respects hierarchy', () => {
    auth.authenticate('user-1', 't1', ['viewer'])
    expect(auth.checkRole('user-1', 'viewer')).toBe(true)
    expect(auth.checkRole('user-1', 'admin')).toBe(false)
  })

  it('isCrossTenant detects cross-tenant', () => {
    auth.authenticate('user-1', 't1', ['admin'])
    expect(auth.isCrossTenant('user-1', 't1')).toBe(false)
    expect(auth.isCrossTenant('user-1', 't2')).toBe(true)
  })

  it('admin has all scopes', () => {
    auth.authenticate('admin-1', 't1', ['admin'])
    const scopes = ['run:read', 'run:write', 'action:read', 'action:write', 'approval:read', 'approval:write', 'artifact:read', 'artifact:write', 'world:read', 'world:write']
    for (const scope of scopes) {
      expect(auth.authorize('admin-1', scope as 'run:read', 't1').allowed).toBe(true)
    }
  })
})
