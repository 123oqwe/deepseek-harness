import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign, createPrivateKey } from 'node:crypto'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  initTrustKernel,
  isKernelInitialized,
  resetKernelForTesting,
  GENESIS_HASH,
  requireKernel,
} from '../src/index.ts'

/** Generate a real RSA key pair for crypto verification tests. */
function generateTestKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

/** Sign data with RSA-SHA256. */
function signData(data: Uint8Array, privateKeyPem: string): Buffer {
  return sign('RSA-SHA256', Buffer.from(data), createPrivateKey(privateKeyPem))
}

describe('P0-02 Trust Kernel boundary', () => {
  let tempDir: string

  beforeEach(() => {
    resetKernelForTesting()
    tempDir = mkdtempSync(join(tmpdir(), 'dsh-trust-kernel-test-'))
  })

  afterEach(() => {
    resetKernelForTesting()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('initializes before any plugin loads', () => {
    expect(isKernelInitialized()).toBe(false)
    const handle = initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    expect(isKernelInitialized()).toBe(true)
    expect(handle).toBeTruthy()
  })

  it('forbids re-initialization', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    expect(() => initTrustKernel({ auditLogPath: join(tempDir, 'audit2.log') })).toThrow('already initialized')
  })

  it('root principal has stable id and insecure flag', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    expect(kernel.principal.id).toBeTruthy()
    expect(kernel.principal.insecure).toBe(false)
  })

  it('insecure mode sets principal.insecure = true', () => {
    initTrustKernel({ insecure: true, auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    expect(kernel.principal.insecure).toBe(true)
  })

  it('kernel deny is monotonic and cannot be overridden', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const result = kernel.evaluatePolicy({
      capability: 'kernel:replace',
      principal: kernel.principal,
    })
    expect(result.decision).toBe('deny')
    expect(result.source).toBe('kernel')

    // Even in insecure mode, kernel-level deny still applies
    resetKernelForTesting()
    initTrustKernel({ insecure: true, auditLogPath: join(tempDir, 'audit.log') })
    const insecureKernel = requireKernel()
    const result2 = insecureKernel.evaluatePolicy({
      capability: 'kernel:replace',
      principal: insecureKernel.principal,
    })
    expect(result2.decision).toBe('deny')
  })

  it('non-kernel capabilities are delegated to plugins', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const result = kernel.evaluatePolicy({
      capability: 'fs:write',
      principal: kernel.principal,
    })
    expect(result.decision).toBe('allow')
    expect(result.source).toBe('delegated')
  })

  it('audit chain is tamper-evident', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const headBefore = kernel.auditHead
    expect(headBefore).not.toBe(GENESIS_HASH)

    const record = kernel.appendAudit('test:event', { foo: 'bar' })
    expect(record.seq).toBeGreaterThan(0)
    expect(record.prevHash).toBe(headBefore)
    expect(record.hash).not.toBe(record.prevHash)
    expect(kernel.auditHead).toBe(record.hash)
  })

  it('audit chain is durable: survives process restart (new kernel instance)', () => {
    const auditPath = join(tempDir, 'audit.log')
    initTrustKernel({ auditLogPath: auditPath })
    const kernel1 = requireKernel()
    kernel1.appendAudit('event:before-crash', { task: 'running' })
    const headBeforeCrash = kernel1.auditHead

    // Simulate crash: reset kernel, re-initialize with same audit path
    resetKernelForTesting()
    initTrustKernel({ auditLogPath: auditPath })
    const kernel2 = requireKernel()

    // The kernel:init record on re-init should chain from the previous head.
    // This proves the audit log is durable: the new kernel instance read
    // the previous chain from disk and continued from it.
    const initRecord = kernel2.appendAudit('event:after-restart', { task: 'restarted' })
    // The prevHash of the first new record after re-init must be the
    // head that was on disk when the new kernel loaded, which includes
    // the kernel:init record. The key assertion is that the chain is
    // continuous: the init record's prevHash equals headBeforeCrash.
    // We can verify this by reading the audit log file.
    const logContent = readFileSync(auditPath, 'utf8')
    const records = logContent.trim().split('\n').map(l => JSON.parse(l) as { prevHash: string; type: string })
    // Find the kernel:init record from the second kernel instance
    const secondInit = records.find(r => r.type === 'kernel:init' && r.prevHash === headBeforeCrash)
    expect(secondInit).toBeTruthy()
    // The new record chains from the second init's hash
    expect(initRecord.prevHash).not.toBe(GENESIS_HASH)
  })

  it('audit log file exists on disk after append', () => {
    const auditPath = join(tempDir, 'audit.log')
    initTrustKernel({ auditLogPath: auditPath })
    const kernel = requireKernel()
    kernel.appendAudit('disk:check', { value: 42 })
    expect(existsSync(auditPath)).toBe(true)
    const content = readFileSync(auditPath, 'utf8')
    expect(content).toContain('disk:check')
  })

  it('signature verification uses real crypto: rejects random bytes with trusted keyId', () => {
    const { publicKey } = generateTestKeys()
    initTrustKernel({
      trustedKeys: { 'test-key': publicKey },
      auditLogPath: join(tempDir, 'audit.log'),
    })
    const kernel = requireKernel()

    // Random bytes as signature must FAIL, even with a trusted key id.
    // The prototype accepted any bytes; the fix uses real crypto.verify().
    const randomSig = new Uint8Array(256)
    for (let i = 0; i < 256; i++) randomSig[i] = Math.floor(Math.random() * 256)
    const result = kernel.verifySignature(
      new Uint8Array([1, 2, 3]),
      randomSig,
      'test-key',
    )
    expect(result.valid).toBe(false)
    expect(result.keyId).toBe('test-key')
  })

  it('signature verification uses real crypto: accepts valid signature', () => {
    const { publicKey, privateKey } = generateTestKeys()
    initTrustKernel({
      trustedKeys: { 'test-key': publicKey },
      auditLogPath: join(tempDir, 'audit.log'),
    })
    const kernel = requireKernel()

    const data = new Uint8Array([1, 2, 3, 4, 5])
    const validSig = signData(data, privateKey)
    const result = kernel.verifySignature(data, validSig, 'test-key')
    expect(result.valid).toBe(true)
    expect(result.keyId).toBe('test-key')
  })

  it('signature verification rejects untrusted key ids', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const result = kernel.verifySignature(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      'unknown-key',
    )
    expect(result.valid).toBe(false)
  })

  it('signature verification rejects missing key id', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const result = kernel.verifySignature(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    )
    expect(result.valid).toBe(false)
  })

  it('insecure mode skips signature verification', () => {
    initTrustKernel({ insecure: true, auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const result = kernel.verifySignature(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    )
    expect(result.valid).toBe(true)
  })

  it('tenant boundary rejects foreign principals', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const foreignPrincipal = { id: 'foreign-id', insecure: false }
    expect(kernel.assertTenant({
      tenantId: 'tenant-a',
      principal: foreignPrincipal,
    })).toBe(false)
  })

  it('tenant boundary accepts own principal', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    expect(kernel.assertTenant({
      tenantId: 'tenant-a',
      principal: kernel.principal,
    })).toBe(true)
  })

  it('sandbox attestation queries real OS environment (not hardcoded success)', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const attestation = kernel.verifySandboxAttestation()

    // The attestation must not return hardcoded "attested: true" without checking.
    // On a development machine without sandbox, it should return attested: false.
    // On a sandboxed CI runner, it may return attested: true with a real method.
    if (attestation.attested) {
      // If attested, the method must be a real OS mechanism, not "kernel-boot-check"
      expect(attestation.method).not.toBe('kernel-boot-check')
      expect(attestation.method).not.toBe('hardcoded')
      expect(attestation.reason).toBeTruthy()
    } else {
      // If not attested, the reason must explain what was checked
      expect(attestation.reason).toContain('no sandbox')
    }
  })

  it('sandbox attestation is skipped in insecure mode', () => {
    initTrustKernel({ insecure: true, auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const attestation = kernel.verifySandboxAttestation()
    expect(attestation.attested).toBe(false)
    expect(attestation.reason).toContain('DEVELOPMENT ONLY')
  })

  it('kernel API has no model-visible text', () => {
    initTrustKernel({ auditLogPath: join(tempDir, 'audit.log') })
    const kernel = requireKernel()
    const policyResult = kernel.evaluatePolicy({
      capability: 'fs:read',
      principal: kernel.principal,
    })
    expect(typeof policyResult.decision).toBe('string')
    expect(['allow', 'deny']).toContain(policyResult.decision)
    expect(typeof policyResult.reason).toBe('string')
  })
})
