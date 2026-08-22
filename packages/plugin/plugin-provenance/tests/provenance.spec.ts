import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import {
  registerTrustedRoot,
  clearTrustedRoots,
  verifySignature,
  computeDigest,
  generateSBOM,
  verifySBOM,
} from '../src/index.ts'

describe('P1-02 Plugin Provenance', () => {
  beforeEach(() =>{  clearTrustedRoots() })

  describe('signature verification', () => {
    it('computes digest of plugin content', () => {
      const data = new TextEncoder().encode('plugin-content')
      const digest = computeDigest(data)
      expect(digest).toMatch(/^[0-9a-f]{64}$/)
    })

    it('rejects unknown key id', () => {
      const result = verifySignature(new Uint8Array([1]), new Uint8Array([2]), 'unknown-key')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('unknown')
    })

    it('verifies signature with trusted root', () => {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
      registerTrustedRoot('root-1', publicKey.export({ type: 'spki', format: 'pem' }) as string, 'official')
      const data = new TextEncoder().encode('plugin-content')
      const signature = cryptoSign('sha256', data, privateKey.export({ type: 'pkcs8', format: 'pem' }))
      const result = verifySignature(data, new Uint8Array(signature), 'root-1')
      expect(result.valid).toBe(true)
      expect(result.signer).toBe('official')
    })
  })

  describe('SBOM', () => {
    it('generates SBOM from dependencies', () => {
      const sbom = generateSBOM('test-plugin', '1.0.0', { 'dep-a': '^1.0.0', 'dep-b': '^2.0.0' })
      expect(sbom.pluginName).toBe('test-plugin')
      expect(sbom.totalDependencies).toBe(2)
      expect(sbom.entries[0]!.name).toBe('dep-a')
      expect(sbom.entries[0]!.type).toBe('runtime')
    })

    it('verifies SBOM against installed packages', () => {
      const sbom = generateSBOM('test', '1.0', { 'dep-a': '^1.0', 'dep-b': '^2.0' })
      const result = verifySBOM(sbom, new Set(['dep-a', 'dep-b']))
      expect(result.verified).toBe(true)
    })

    it('detects missing dependencies', () => {
      const sbom = generateSBOM('test', '1.0', { 'dep-a': '^1.0', 'dep-b': '^2.0' })
      const result = verifySBOM(sbom, new Set(['dep-a']))
      expect(result.verified).toBe(false)
      expect(result.missing).toContain('dep-b')
    })

    it('detects unexpected dependencies', () => {
      const sbom = generateSBOM('test', '1.0', { 'dep-a': '^1.0' })
      const result = verifySBOM(sbom, new Set(['dep-a', 'unexpected-dep']))
      expect(result.verified).toBe(false)
      expect(result.unexpected).toContain('unexpected-dep')
    })
  })
})
