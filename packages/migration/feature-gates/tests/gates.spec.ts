import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerGate,
  resolveGate,
  setOverride,
  recordShadowEvent,
  getShadowEvents,
  isExpired,
  assertNoExpiredGates,
  registerBuiltinGates,
  clearAll,
  setCurrentVersion,
  grantKernelAdmin,
  ExpiredGateError,
  GateDowngradeError,
} from '../src/index.ts'

describe('P0-05 Feature Gates', () => {
  beforeEach(() => { clearAll() })
  afterEach(() => { clearAll() })

  it('registers and resolves a gate', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test gate',
      owner: 'test-team',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'off', web: 'shadow' },
    })
    const resolved = resolveGate('test-gate', 'web')
    expect(resolved.state).toBe('shadow')
    expect(resolved.source).toBe('profile')
    expect(resolved.overrideChain).toHaveLength(2)
  })

  it('resolves to default when profile not found', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'off' },
    })
    const resolved = resolveGate('test-gate', 'unknown-profile')
    expect(resolved.state).toBe('off')
  })

  it('applies home and CLI overrides in order', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'off', web: 'off' },
    })
    setOverride('test-gate', '__home__', 'shadow')
    let resolved = resolveGate('test-gate', 'web')
    expect(resolved.state).toBe('shadow')
    expect(resolved.source).toBe('home')

    setOverride('test-gate', '__cli__', 'enforce')
    resolved = resolveGate('test-gate', 'web')
    expect(resolved.state).toBe('enforce')
    expect(resolved.source).toBe('cli')
    expect(resolved.overrideChain).toHaveLength(4)
  })

  it('prevents enforce -> off downgrade without kernel admin', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'enforce' },
    })
    expect(() => { setOverride('test-gate', '__cli__', 'off') }).toThrow(GateDowngradeError)
  })

  it('prevents enforce -> shadow downgrade without kernel admin', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'enforce' },
    })
    expect(() => { setOverride('test-gate', '__cli__', 'shadow') }).toThrow(GateDowngradeError)
  })

  it('allows enforce -> off downgrade with kernel admin', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'enforce' },
    })
    grantKernelAdmin()
    expect(() => { setOverride('test-gate', '__cli__', 'off') }).not.toThrow()
    const resolved = resolveGate('test-gate', 'web')
    expect(resolved.state).toBe('off')
  })

  it('records shadow comparison events with redaction', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'shadow' },
    })
    const event = recordShadowEvent(
      'test-gate',
      { action: 'write', path: '/safe' },
      { action: 'write', path: '/safe' },
      ['secret-token'],
    )
    expect(event.equal).toBe(true)
    expect(event.redactedPayload).not.toContain('secret-token')
    expect(getShadowEvents('test-gate')).toHaveLength(1)
  })

  it('shadow event detects differences', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'shadow' },
    })
    const event = recordShadowEvent(
      'test-gate',
      { result: 'allow' },
      { result: 'deny' },
    )
    expect(event.equal).toBe(false)
  })

  it('same request gives same user-visible result in legacy vs shadow', () => {
    registerGate({
      id: 'test-gate',
      description: 'Test',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'shadow' },
    })
    const legacyResult = { status: 'ok', data: [1, 2, 3] }
    const shadowResult = { status: 'ok', data: [1, 2, 3] }
    const event = recordShadowEvent('test-gate', legacyResult, shadowResult)
    expect(event.equal).toBe(true)
  })

  it('expired gate fails release gate', () => {
    registerGate({
      id: 'old-gate',
      description: 'Old',
      owner: 't',
      introducedVersion: '0.0.1',
      removalVersion: '0.0.1',
      defaultByProfile: { __default__: 'off' },
    })
    expect(isExpired('old-gate')).toBe(true)
    expect(() => { assertNoExpiredGates() }).toThrow(ExpiredGateError)
  })

  it('non-expired gate passes release gate', () => {
    registerGate({
      id: 'new-gate',
      description: 'New',
      owner: 't',
      introducedVersion: '0.1.0',
      removalVersion: '2.0.0',
      defaultByProfile: { __default__: 'off' },
    })
    setCurrentVersion('1.0.0')
    expect(isExpired('new-gate')).toBe(false)
    expect(() => { assertNoExpiredGates() }).not.toThrow()
  })

  it('registers built-in gates', () => {
    registerBuiltinGates()
    const trustResolved = resolveGate('trust-kernel', 'web')
    expect(trustResolved.state).toBe('shadow')
    const policyResolved = resolveGate('policy-enforcement', 'web')
    expect(policyResolved.state).toBe('shadow')
    const journalResolved = resolveGate('run-journal', 'headless')
    expect(journalResolved.state).toBe('shadow')
  })
})
