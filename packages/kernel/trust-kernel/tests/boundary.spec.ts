import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initTrustKernel, isKernelInitialized, resetKernelForTesting, GENESIS_HASH, requireKernel } from '../src/index.ts'

describe('P0-02 Trust Kernel boundary', () => {
  beforeEach(() => {
    resetKernelForTesting()
  })

  afterEach(() => {
    resetKernelForTesting()
  })

  it('initializes before any plugin loads', () => {
    expect(isKernelInitialized()).toBe(false)
    const handle = initTrustKernel()
    expect(isKernelInitialized()).toBe(true)
    expect(handle).toBeTruthy()
  })

  it('forbids re-initialization', () => {
    initTrustKernel()
    expect(() => initTrustKernel()).toThrow('already initialized')
  })

  it('root principal has stable id and insecure flag', () => {
    initTrustKernel()
    const kernel = requireKernel()
    expect(kernel.principal.id).toBeTruthy()
    expect(kernel.principal.insecure).toBe(false)
  })

  it('insecure mode sets principal.insecure = true', () => {
    initTrustKernel({ insecure: true })
    const kernel = requireKernel()
    expect(kernel.principal.insecure).toBe(true)
  })

  it('kernel deny is monotonic and cannot be overridden', () => {
    initTrustKernel()
    const kernel = requireKernel()
    const result = kernel.evaluatePolicy({
      capability: 'kernel:replace',
      principal: kernel.principal,
    })
    expect(result.decision).toBe('deny')
    expect(result.source).toBe('kernel')
    // Even in insecure mode, kernel-level deny still applies
    resetKernelForTesting()
    initTrustKernel({ insecure: true })
    const insecureKernel = requireKernel()
    const result2 = insecureKernel.evaluatePolicy({
      capability: 'kernel:replace',
      principal: insecureKernel.principal,
    })
    expect(result2.decision).toBe('deny')
  })

  it('non-kernel capabilities are delegated to plugins', () => {
    initTrustKernel()
    const kernel = requireKernel()
    const result = kernel.evaluatePolicy({
      capability: 'fs:write',
      principal: kernel.principal,
    })
    expect(result.decision).toBe('allow')
    expect(result.source).toBe('delegated')
  })

  it('audit chain is tamper-evident', () => {
    initTrustKernel()
    const kernel = requireKernel()
    // The init record is already appended
    const headBefore = kernel.auditHead
    expect(headBefore).not.toBe(GENESIS_HASH)

    const record = kernel.appendAudit('test:event', { foo: 'bar' })
    expect(record.seq).toBeGreaterThan(0)
    expect(record.prevHash).toBe(headBefore)
    expect(record.hash).not.toBe(record.prevHash)
    expect(kernel.auditHead).toBe(record.hash)
  })

  it('signature verification rejects untrusted keys in production', () => {
    initTrustKernel()
    const kernel = requireKernel()
    const result = kernel.verifySignature(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    )
    expect(result.valid).toBe(false)
  })

  it('signature verification accepts trusted keys', () => {
    initTrustKernel({ trustedKeyIds: ['trusted-root-1'] })
    const kernel = requireKernel()
    const result = kernel.verifySignature(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      'trusted-root-1',
    )
    expect(result.valid).toBe(true)
    expect(result.keyId).toBe('trusted-root-1')
  })

  it('insecure mode skips signature verification', () => {
    initTrustKernel({ insecure: true })
    const kernel = requireKernel()
    const result = kernel.verifySignature(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    )
    expect(result.valid).toBe(true)
  })

  it('tenant boundary rejects foreign principals', () => {
    initTrustKernel()
    const kernel = requireKernel()
    const foreignPrincipal = { id: 'foreign-id', insecure: false }
    expect(kernel.assertTenant({
      tenantId: 'tenant-a',
      principal: foreignPrincipal,
    })).toBe(false)
  })

  it('tenant boundary accepts own principal', () => {
    initTrustKernel()
    const kernel = requireKernel()
    expect(kernel.assertTenant({
      tenantId: 'tenant-a',
      principal: kernel.principal,
    })).toBe(true)
  })

  it('sandbox attestation passes in production mode', () => {
    initTrustKernel()
    const kernel = requireKernel()
    const attestation = kernel.verifySandboxAttestation()
    expect(attestation.attested).toBe(true)
  })

  it('sandbox attestation is skipped in insecure mode', () => {
    initTrustKernel({ insecure: true })
    const kernel = requireKernel()
    const attestation = kernel.verifySandboxAttestation()
    expect(attestation.attested).toBe(false)
    expect(attestation.reason).toContain('DEVELOPMENT ONLY')
  })

  it('kernel API has no model-visible text', () => {
    initTrustKernel()
    const kernel = requireKernel()
    // The kernel interface should not expose any LLM-facing strings
    // Its methods return structured types, not free text
    const policyResult = kernel.evaluatePolicy({
      capability: 'fs:read',
      principal: kernel.principal,
    })
    expect(typeof policyResult.decision).toBe('string')
    expect(['allow', 'deny']).toContain(policyResult.decision)
    // Reason is for audit, not for model consumption
    expect(typeof policyResult.reason).toBe('string')
  })
})
