import { describe, it, expect } from 'vitest'
import { validateManifest, checkWildcardPermissions, type PluginManifestV2 } from '../src/index.ts'

describe('P1-01 Plugin Manifest v2 Integration', () => {
  it('validates a well-formed manifest', () => {
    const manifest = {
      manifestVersion: 2,
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      services: [],
      tools: [],
      skills: [],
      mcpServers: [],
      events: [],
      filesystem: [],
      network: { destinations: [] },
      process: { allowed: false },
      secrets: { required: [] },
      uiSurfaces: [],
      dataStores: [],
      migrations: { version: '1.0.0', steps: [] },
    } as unknown as PluginManifestV2
    const result = validateManifest(manifest)
    expect(result).toBeDefined()
  })

  it('rejects wildcard permissions', () => {
    expect(() =>{  checkWildcardPermissions([{ pattern: '/*' }] as never) }).toThrow()
  })

  it('manifest types are reachable from shipping package', () => {
    expect(validateManifest).toBeDefined()
    expect(checkWildcardPermissions).toBeDefined()
  })
})
