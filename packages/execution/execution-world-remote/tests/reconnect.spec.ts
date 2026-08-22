import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createAttestation, verifyAttestation, createRemote, attach, heartbeat, snapshot, terminate, getRemote, clearRemotes } from '../src/index.ts'

describe('P3-09 Remote ExecutionWorld', () => {
  beforeEach(() => clearRemotes())
  afterEach(() => clearRemotes())

  it('creates attestation', () => {
    const att = createAttestation({
      imageDigest: 'abc', policyDigest: 'def', tenantId: 't1',
      networkProxyVerified: true, secretInjectionVerified: true,
    })
    expect(att.valid).toBe(true)
  })

  it('rejects attestation with missing verification', () => {
    const att = createAttestation({
      imageDigest: 'abc', policyDigest: 'def', tenantId: 't1',
      networkProxyVerified: false, secretInjectionVerified: true,
    })
    expect(att.valid).toBe(false)
  })

  it('verifyAttestation checks image and tenant', () => {
    const att = createAttestation({
      imageDigest: 'abc', policyDigest: 'def', tenantId: 't1',
      networkProxyVerified: true, secretInjectionVerified: true,
    })
    expect(verifyAttestation(att, 'abc', 't1')).toBe(true)
    expect(verifyAttestation(att, 'wrong', 't1')).toBe(false)
    expect(verifyAttestation(att, 'abc', 'wrong')).toBe(false)
  })

  it('creates remote world with attestation', () => {
    const att = createAttestation({
      imageDigest: 'abc', policyDigest: 'def', tenantId: 't1',
      networkProxyVerified: true, secretInjectionVerified: true,
    })
    const world = createRemote(att)
    expect(world.state).toBe('running')
    expect(world.attestation).toBeDefined()
  })

  it('heartbeat updates lastHeartbeat', () => {
    const world = createRemote()
    const updated = heartbeat(world.id)
    expect(updated.lastHeartbeat).toBeTruthy()
  })

  it('snapshot and terminate', () => {
    const world = createRemote()
    snapshot(world.id)
    terminate(world.id)
    const final = getRemote(world.id)
    expect(final!.state).toBe('terminated')
  })
})
