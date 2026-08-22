import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  resolveGate, setOverride, registerGate, clearAll,
  grantKernelAdmin, revokeKernelAdmin, registerBuiltinGates,
  assertNoExpiredGates,
} from '../src/index.ts'
import type { FeatureGate } from '../src/types.ts'

describe('P0-05 Feature Gates Integration', () => {
  beforeEach(() => { clearAll(); registerBuiltinGates() })
  afterEach(() =>{  clearAll(); })

  it('override chain works: bundle -> profile -> home -> CLI (last wins)', () => {
    const gate: FeatureGate = {
      id: 'test-gate', description: 'test', owner: 'test',
      introducedVersion: '0.1.0', removalVersion: '999.0.0',
      defaultByProfile: { 'default': 'off' },
    }
    registerGate(gate)
    setOverride('test-gate', '__cli__', 'shadow')
    const result = resolveGate('test-gate', 'default')
    expect(result.state).toBe('shadow')
  })

  it('enforce -> off/shadow downgrade requires kernel admin permission', () => {
    const gate: FeatureGate = {
      id: 'test-gate', description: 'test', owner: 'test',
      introducedVersion: '0.1.0', removalVersion: '999.0.0',
      defaultByProfile: { 'default': 'off' },
    }
    registerGate(gate)
    setOverride('test-gate', '__cli__', 'enforce')
    expect(resolveGate('test-gate', 'default').state).toBe('enforce')
    revokeKernelAdmin()
    expect(() =>{  setOverride('test-gate', '__cli__', 'shadow'); }).toThrow()
    grantKernelAdmin()
    setOverride('test-gate', '__cli__', 'shadow')
    expect(resolveGate('test-gate', 'default').state).toBe('shadow')
  })

  it('expired gates fail release gate', () => {
    const expiredGate: FeatureGate = {
      id: 'expired-gate', description: 'expired', owner: 'test',
      introducedVersion: '0.0.1', removalVersion: '0.0.1',
      defaultByProfile: { 'default': 'enforce' },
    }
    registerGate(expiredGate)
    expect(() =>{  assertNoExpiredGates(); }).toThrow()
  })
})
