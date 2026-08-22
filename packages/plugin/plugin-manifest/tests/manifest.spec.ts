import { describe, it, expect } from 'vitest'
import {
  validateManifest,
  validateLegacyBundle,
  isLegacyBundle,
  legacyToManifest,
  compareDeclaredVsObserved,
  type PluginManifestV2,
} from '../src/index.ts'

const benignManifest: PluginManifestV2 = {
  manifestVersion: 2,
  name: 'benign-plugin',
  version: '1.0.0',
  description: 'A benign plugin with minimal permissions',
  services: [{ name: 'fs', role: 'consumer' }],
  tools: [{
    name: 'read-file',
    description: 'Read a file',
    sideEffect: 'none',
    dataClassification: 'public',
  }],
  executionMode: 'in-process',
  compatibility: { minHarnessVersion: '0.1.0' },
}

const overprivilegedManifest: PluginManifestV2 = {
  manifestVersion: 2,
  name: 'overprivileged-plugin',
  version: '1.0.0',
  description: 'Requests wildcard permissions',
  services: [],
  tools: [],
  filesystem: [{ path: '/*', access: 'read-write', recursive: true }],
  network: [{ destinations: ['*'], methods: ['GET'] }],
  secrets: [{ requestedSecrets: ['*'], access: 'read' }],
  process: { allowedCommands: ['*'], shell: true },
  executionMode: 'in-process',
  compatibility: { minHarnessVersion: '0.1.0' },
}

const undeclaredToolManifest: PluginManifestV2 = {
  manifestVersion: 2,
  name: 'undeclared-tool-plugin',
  version: '1.0.0',
  description: 'Registers undeclared tools',
  services: [],
  tools: [{
    name: 'declared-tool',
    description: 'Declared',
    sideEffect: 'none',
    dataClassification: 'public',
  }],
  executionMode: 'in-process',
  compatibility: { minHarnessVersion: '0.1.0' },
}

const undeclaredNetworkManifest: PluginManifestV2 = {
  manifestVersion: 2,
  name: 'undeclared-network-plugin',
  version: '1.0.0',
  description: 'Accesses undeclared network destinations',
  services: [],
  tools: [],
  network: [{ destinations: ['https://allowed.example.com'], methods: ['GET'] }],
  executionMode: 'in-process',
  compatibility: { minHarnessVersion: '0.1.0' },
}

describe('P1-01 Plugin Manifest v2', () => {
  describe('validateManifest', () => {
    it('accepts a benign manifest', () => {
      const result = validateManifest(benignManifest)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.trustLevel).toBe('L1-inspected')
      expect(result.legacy).toBe(false)
    })

    it('rejects wildcard filesystem paths', () => {
      const result = validateManifest(overprivilegedManifest)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('filesystem wildcard'))).toBe(true)
    })

    it('rejects wildcard network destinations', () => {
      const result = validateManifest(overprivilegedManifest)
      expect(result.errors.some(e => e.includes('network wildcard'))).toBe(true)
    })

    it('rejects wildcard secrets', () => {
      const result = validateManifest(overprivilegedManifest)
      expect(result.errors.some(e => e.includes('secrets wildcard'))).toBe(true)
    })

    it('rejects wildcard process commands', () => {
      const result = validateManifest(overprivilegedManifest)
      expect(result.errors.some(e => e.includes('process wildcard'))).toBe(true)
    })

    it('requires sideEffect and dataClassification on tools', () => {
      const manifest: PluginManifestV2 = {
        ...benignManifest,
        tools: [{ name: 'bad-tool', description: 'No sideEffect', // @ts-expect-error intentional undefined for validation test
          sideEffect: undefined, dataClassification: undefined }],
      }
      const result = validateManifest(manifest)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('sideEffect'))).toBe(true)
      expect(result.errors.some(e => e.includes('dataClassification'))).toBe(true)
    })

    it('requires auth for external side effects', () => {
      const manifest: PluginManifestV2 = {
        ...benignManifest,
        tools: [{ name: 'pay-tool', description: 'Payment', sideEffect: 'external', dataClassification: 'restricted' }],
      }
      const result = validateManifest(manifest)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('authAudience'))).toBe(true)
    })

    it('requires transport for MCP servers', () => {
      const manifest: PluginManifestV2 = {
        ...benignManifest,
        mcpServers: [{ name: 'bad-mcp', // @ts-expect-error intentional undefined for validation test
          transport: undefined, auth: 'none', sideEffect: 'none', tools: [] }],
      }
      const result = validateManifest(manifest)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('transport'))).toBe(true)
    })

    it('requires auth for irreversible MCP side effects', () => {
      const manifest: PluginManifestV2 = {
        ...benignManifest,
        mcpServers: [{ name: 'pay-mcp', transport: 'stdio', auth: 'none', sideEffect: 'irreversible', tools: [] }],
      }
      const result = validateManifest(manifest)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('auth'))).toBe(true)
    })
  })

  describe('compareDeclaredVsObserved', () => {
    it('detects undeclared tool registration', () => {
      const violations = compareDeclaredVsObserved(
        undeclaredToolManifest,
        ['declared-tool', 'undeclared-tool'],
        [],
      )
      expect(violations).toHaveLength(1)
      expect(violations[0]).toContain('undeclared-tool')
    })

    it('detects undeclared network destination', () => {
      const violations = compareDeclaredVsObserved(
        undeclaredNetworkManifest,
        [],
        ['https://allowed.example.com', 'https://forbidden.example.com'],
      )
      expect(violations).toHaveLength(1)
      expect(violations[0]).toContain('forbidden.example.com')
    })

    it('passes when all observed are declared', () => {
      const violations = compareDeclaredVsObserved(
        benignManifest,
        ['read-file'],
        [],
      )
      expect(violations).toHaveLength(0)
    })
  })

  describe('legacy bundle compat', () => {
    it('detects legacy v1 bundle', () => {
      const pkg = { name: 'old-plugin', version: '0.1.0', dsh: { bundle: 'cordis.patch.yml' } }
      expect(isLegacyBundle(pkg)).toBe(true)
    })

    it('converts legacy to manifest and marks as legacy-untrusted', () => {
      const pkg = { name: 'old-plugin', version: '0.1.0', dsh: { bundle: 'cordis.patch.yml' } }
      const manifest = legacyToManifest(pkg)
      expect(manifest.manifestVersion).toBe(2)
      expect(manifest.description).toContain('legacy-untrusted')
      expect(manifest.tools).toHaveLength(0)
    })

    it('validates legacy bundle with warning', () => {
      const pkg = { name: 'old-plugin', version: '0.1.0', dsh: { bundle: 'cordis.patch.yml' } }
      const result = validateLegacyBundle(pkg)
      expect(result.legacy).toBe(true)
      expect(result.trustLevel).toBe('L0-unknown')
      expect(result.warnings.some(w => w.includes('legacy-untrusted'))).toBe(true)
    })
  })
})
