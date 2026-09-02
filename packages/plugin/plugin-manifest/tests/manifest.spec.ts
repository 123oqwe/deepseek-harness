/**
 * Contract-stage proof for Plugin Manifest v2 (Epic P1-01): schema
 * validation (must[0]/must[1]), the static-data check (must[2]), the legacy
 * `dsh.bundle` compatibility read (must[3]), wildcard-permission detection
 * (acceptance[0]), and golden-fixture/backward-compatibility agreement
 * between the hand-written TypeScript validator and the JSON Schema document
 * (acceptance[2]). Also this epic's registry-declared Fault-stage (F) file:
 * the final `describe` block below constructs adversarial input against the
 * real, already-shipped validator and comparison logic, not just structural
 * happy/sad-path cases.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { compareDeclaredToObserved, decidePluginTrust, evaluatePreMountAdmission, type ObservedPluginCapabilities } from '../src/index.ts'
import {
  classifyPluginDeclaration,
  detectWildcardPermissions,
  isDeniedInProductionByDefault,
  parseLegacyBundleDeclaration,
  validatePluginManifestV2,
} from '../src/validate.ts'
import type { PluginManifestV2 } from '../src/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(here, 'fixtures')
const schemaPath = join(here, '..', '..', '..', '..', 'spec', 'capability-manifest.schema.json')

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8'))
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>
const ajv = new Ajv2020({ allErrors: true, strict: true })
const validateAgainstSchema = ajv.compile(schema)

describe('PluginManifestV2 schema validation', () => {
  it('accepts a fully-declared benign manifest', () => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
  })

  it('rejects a manifest that is not an object', () => {
    const result = validatePluginManifestV2('not-an-object')
    expect(result.valid).toBe(false)
  })

  it('rejects a manifest with manifestVersion other than 2', () => {
    const manifest = loadFixture('benign') as Record<string, unknown>
    const result = validatePluginManifestV2({ ...manifest, manifestVersion: 1 })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'manifestVersion')).toBe(true)
    }
  })

  it('rejects a tool capability missing must[1] effect fields', () => {
    const result = validatePluginManifestV2(loadFixture('undeclared-tool'))
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'tools[0].sideEffectClass')).toBe(true)
      expect(result.errors.some(error => error.path === 'tools[0].authAudience')).toBe(true)
      expect(result.errors.some(error => error.path === 'tools[0].allowedDestinations')).toBe(true)
      expect(result.errors.some(error => error.path === 'tools[0].dataClassification')).toBe(true)
    }
  })

  it('rejects an MCP server with an empty allowedDestinations as an undeclared network destination', () => {
    const result = validatePluginManifestV2(loadFixture('undeclared-network'))
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(
        error => error.path === 'mcp.servers[0].allowedDestinations'
          && error.message.includes('at least one destination'),
      )).toBe(true)
    }
  })

  it('rejects an MCP server missing transport and auth mechanism', () => {
    const manifest = loadFixture('benign') as { mcp: { servers: Record<string, unknown>[] } }
    const server = { ...manifest.mcp.servers[0] }
    delete server.transport
    delete server.authMechanism
    const result = validatePluginManifestV2({ ...manifest, mcp: { servers: [server] } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'mcp.servers[0].transport')).toBe(true)
      expect(result.errors.some(error => error.path === 'mcp.servers[0].authMechanism')).toBe(true)
    }
  })

  it('rejects an MCP server name that does not match the mcp-client serverName grammar', () => {
    const manifest = loadFixture('benign') as { mcp: { servers: Record<string, unknown>[] } }
    const server = { ...manifest.mcp.servers[0], name: 'not a valid server name!' }
    const result = validatePluginManifestV2({ ...manifest, mcp: { servers: [server] } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'mcp.servers[0].name')).toBe(true)
    }
  })

  it('rejects a skill name that does not match the dsh-skill SKILL_NAME grammar', () => {
    const manifest = loadFixture('benign') as { skills: Record<string, unknown>[] }
    const skill = { ...manifest.skills[0], name: 'Not_Kebab_Case' }
    const result = validatePluginManifestV2({ ...manifest, skills: [skill] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'skills[0].name')).toBe(true)
    }
  })

  it('rejects an unrecognized sideEffectClass enum value', () => {
    const manifest = loadFixture('benign') as { tools: Record<string, unknown>[] }
    const tool = { ...manifest.tools[0], sideEffectClass: 'unlimited' }
    const result = validatePluginManifestV2({ ...manifest, tools: [tool] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'tools[0].sideEffectClass')).toBe(true)
    }
  })

  it('rejects an empty authAudience array', () => {
    const manifest = loadFixture('benign') as { tools: Record<string, unknown>[] }
    const tool = { ...manifest.tools[0], authAudience: [] }
    const result = validatePluginManifestV2({ ...manifest, tools: [tool] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'tools[0].authAudience')).toBe(true)
    }
  })

  it('rejects a manifest carrying a function value as not static data', () => {
    const manifest = loadFixture('benign') as Record<string, unknown>
    const result = validatePluginManifestV2({ ...manifest, compatibility: { dshVersionRange: () => '>=0.1.0' } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.message.includes('executing package code'))).toBe(true)
    }
  })

  it('rejects an array containing undefined as not static data', () => {
    const manifest = loadFixture('benign') as { network: { hostPatterns: unknown[] } }
    const result = validatePluginManifestV2({
      ...manifest,
      network: { hostPatterns: [undefined] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'network.hostPatterns[0]')).toBe(true)
    }
  })

  it('rejects a symbol value as not static data', () => {
    const manifest = loadFixture('benign') as Record<string, unknown>
    const result = validatePluginManifestV2({ ...manifest, compatibility: { dshVersionRange: Symbol('x') } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.message === 'must be static JSON data, not a symbol')).toBe(true)
    }
  })
})

describe('PluginManifestV2 schema validation: rejects each optional field with the wrong type', () => {
  const wrongTypeCases: Array<[string, Record<string, unknown>, string]> = [
    ['services', { services: 'not-an-array' }, 'services'],
    ['tools', { tools: 'not-an-array' }, 'tools'],
    ['skills', { skills: 'not-an-array' }, 'skills'],
    ['mcp (not an object)', { mcp: 'not-an-object' }, 'mcp.servers'],
    ['mcp.servers (not an array)', { mcp: { servers: 'not-an-array' } }, 'mcp.servers'],
    ['events', { events: 'not-an-array' }, 'events'],
    ['filesystem', { filesystem: 'not-an-object' }, 'filesystem'],
    ['filesystem.readPaths', { filesystem: { readPaths: 'not-an-array', writePaths: [] } }, 'filesystem.readPaths'],
    ['network', { network: 'not-an-object' }, 'network'],
    ['process', { process: 'not-an-object' }, 'process'],
    ['secrets', { secrets: 'not-an-array' }, 'secrets'],
    ['uiSurfaces', { uiSurfaces: 'not-an-array' }, 'uiSurfaces'],
    ['dataStores', { dataStores: 'not-an-array' }, 'dataStores'],
    ['migrations', { migrations: 'not-an-array' }, 'migrations'],
  ]

  it.each(wrongTypeCases)('rejects %s with the wrong type', (_label, override, expectedPath) => {
    const manifest = loadFixture('benign') as Record<string, unknown>
    const result = validatePluginManifestV2({ ...manifest, ...override })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === expectedPath)).toBe(true)
    }
  })
})

describe('PluginManifestV2 schema validation: rejects a non-object array item', () => {
  const itemNotObjectCases: Array<[string, Record<string, unknown>, string]> = [
    ['services[0]', { services: [123] }, 'services[0]'],
    ['tools[0]', { tools: [123] }, 'tools[0]'],
    ['skills[0]', { skills: [123] }, 'skills[0]'],
    ['mcp.servers[0]', { mcp: { servers: [123] } }, 'mcp.servers[0]'],
    ['events[0]', { events: [123] }, 'events[0]'],
    ['secrets[0]', { secrets: [123] }, 'secrets[0]'],
    ['uiSurfaces[0]', { uiSurfaces: [123] }, 'uiSurfaces[0]'],
    ['dataStores[0]', { dataStores: [123] }, 'dataStores[0]'],
    ['migrations[0]', { migrations: [123] }, 'migrations[0]'],
  ]

  it.each(itemNotObjectCases)('rejects a non-object %s array item', (_label, override, expectedPath) => {
    const manifest = loadFixture('benign') as Record<string, unknown>
    const result = validatePluginManifestV2({ ...manifest, ...override })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === expectedPath)).toBe(true)
    }
  })
})

describe('PluginManifestV2 schema validation: rejects a wrong-type field inside a well-formed item', () => {
  const fieldTypeCases: Array<[string, Record<string, unknown>, string]> = [
    ['services[0].ctxKey', { services: [{ ctxKey: 123, role: 'provides' }] }, 'services[0].ctxKey'],
    [
      'tools[0].name',
      { tools: [{ name: 123, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'public' }] },
      'tools[0].name',
    ],
    [
      'tools[0].description',
      { tools: [{ name: 'x', description: 123, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'public' }] },
      'tools[0].description',
    ],
    ['events[0].name', { events: [{ name: 123, mode: 'emit' }] }, 'events[0].name'],
    ['secrets[0].key', { secrets: [{ key: 123, reason: 'x' }] }, 'secrets[0].key'],
    ['secrets[0].reason', { secrets: [{ key: 'x', reason: 123 }] }, 'secrets[0].reason'],
    ['uiSurfaces[0].surfaceId', { uiSurfaces: [{ surfaceId: 123 }] }, 'uiSurfaces[0].surfaceId'],
    ['uiSurfaces[0].description', { uiSurfaces: [{ surfaceId: 'x', description: 123 }] }, 'uiSurfaces[0].description'],
    ['dataStores[0].domainName', { dataStores: [{ domainName: 123, dataClassification: 'public' }] }, 'dataStores[0].domainName'],
    ['migrations[0].fromVersion', { migrations: [{ fromVersion: 'x', toVersion: 1, description: 'x' }] }, 'migrations[0].fromVersion'],
    ['migrations[0].toVersion', { migrations: [{ fromVersion: 0, toVersion: 'x', description: 'x' }] }, 'migrations[0].toVersion'],
    ['migrations[0].description', { migrations: [{ fromVersion: 0, toVersion: 1, description: 123 }] }, 'migrations[0].description'],
  ]

  it.each(fieldTypeCases)('rejects %s with the wrong type', (_label, override, expectedPath) => {
    const manifest = loadFixture('benign') as Record<string, unknown>
    const result = validatePluginManifestV2({ ...manifest, ...override })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === expectedPath)).toBe(true)
    }
  })
})

describe('PluginManifestV2 schema validation: CapabilityDestination shapes', () => {
  const destinationCases: Array<[string, unknown, string]> = [
    ['a non-object destination', 123, 'tools[0].allowedDestinations[0]'],
    ['a filesystem destination with a non-string pathPattern', { kind: 'filesystem', pathPattern: 123 }, 'tools[0].allowedDestinations[0].pathPattern'],
    ['a network destination with a non-string hostPattern', { kind: 'network', hostPattern: 123 }, 'tools[0].allowedDestinations[0].hostPattern'],
    ['a process destination with a non-string commandPattern', { kind: 'process', commandPattern: 123 }, 'tools[0].allowedDestinations[0].commandPattern'],
    ['a destination with an unrecognized kind', { kind: 'unknown' }, 'tools[0].allowedDestinations[0].kind'],
  ]

  it.each(destinationCases)('rejects %s', (_label, destination, expectedPath) => {
    const manifest = loadFixture('benign') as { tools: Record<string, unknown>[] }
    const tool = { ...manifest.tools[0], allowedDestinations: [destination] }
    const result = validatePluginManifestV2({ ...manifest, tools: [tool] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === expectedPath)).toBe(true)
    }
  })
})

describe('PluginManifestV2 schema validation: MCP server resources, prompts, and remote-provider skills', () => {
  it('rejects an MCP server with a non-array resources field', () => {
    const manifest = loadFixture('benign') as { mcp: { servers: Record<string, unknown>[] } }
    const server = { ...manifest.mcp.servers[0], resources: 'not-an-array' }
    const result = validatePluginManifestV2({ ...manifest, mcp: { servers: [server] } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'mcp.servers[0].resources')).toBe(true)
    }
  })

  it('rejects an MCP server resources array with a non-object item and a wrong-type uriPattern', () => {
    const manifest = loadFixture('benign') as { mcp: { servers: Record<string, unknown>[] } }
    const server = {
      ...manifest.mcp.servers[0],
      resources: [123, { uriPattern: 456, dataClassification: 'public' }],
    }
    const result = validatePluginManifestV2({ ...manifest, mcp: { servers: [server] } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'mcp.servers[0].resources[0]')).toBe(true)
      expect(result.errors.some(error => error.path === 'mcp.servers[0].resources[1].uriPattern')).toBe(true)
    }
  })

  it('rejects an MCP server with a non-array prompts field', () => {
    const manifest = loadFixture('benign') as { mcp: { servers: Record<string, unknown>[] } }
    const server = { ...manifest.mcp.servers[0], prompts: 'not-an-array' }
    const result = validatePluginManifestV2({ ...manifest, mcp: { servers: [server] } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'mcp.servers[0].prompts')).toBe(true)
    }
  })

  it('rejects an MCP server prompts array with a non-object item', () => {
    const manifest = loadFixture('benign') as { mcp: { servers: Record<string, unknown>[] } }
    const server = { ...manifest.mcp.servers[0], prompts: [123] }
    const result = validatePluginManifestV2({ ...manifest, mcp: { servers: [server] } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'mcp.servers[0].prompts[0].name')).toBe(true)
    }
  })

  it('rejects a skill with a non-object remoteProvider', () => {
    const manifest = loadFixture('benign') as { skills: Record<string, unknown>[] }
    const skill = { ...manifest.skills[0], remoteProvider: 123 }
    const result = validatePluginManifestV2({ ...manifest, skills: [skill] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(error => error.path === 'skills[0].remoteProvider')).toBe(true)
    }
  })
})

describe('wildcard permission detection', () => {
  it('detects wildcard destinations in an overprivileged manifest', () => {
    const result = validatePluginManifestV2(loadFixture('overprivileged'))
    expect(result.valid).toBe(true)
    if (result.valid) {
      const findings = detectWildcardPermissions(result.manifest)
      expect(findings).toEqual(expect.arrayContaining([
        { path: 'tools[0].allowedDestinations[0]', pattern: '/' },
        { path: 'tools[0].allowedDestinations[1]', pattern: '*' },
      ]))
      expect(findings.length).toBe(2)
    }
  })

  it('reports no wildcard findings for a benign manifest', () => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(detectWildcardPermissions(result.manifest)).toEqual([])
    }
  })

  it('detects a wildcard process-command destination behind a remote-sourced skill provider', () => {
    const manifest = loadFixture('benign') as { skills: Record<string, unknown>[] }
    const skill = {
      ...manifest.skills[0],
      remoteProvider: {
        transport: 'stdio',
        authMechanism: 'none',
        sideEffectClass: 'process',
        authAudience: ['model'],
        allowedDestinations: [{ kind: 'process', commandPattern: '*' }],
        dataClassification: 'internal',
      },
    }
    const result = validatePluginManifestV2({ ...manifest, skills: [skill] })
    expect(result.valid).toBe(true)
    if (result.valid) {
      const findings = detectWildcardPermissions(result.manifest)
      expect(findings).toEqual(expect.arrayContaining([
        { path: 'skills[0].remoteProvider.allowedDestinations[0]', pattern: '*' },
      ]))
    }
  })
})

describe('legacy dsh.bundle compatibility read', () => {
  it('classifies a legacy dsh.bundle field as legacy-untrusted', () => {
    const declaration = classifyPluginDeclaration(loadFixture('legacy-bundle'))
    expect(declaration).toEqual({
      kind: 'legacy-untrusted',
      legacy: { trust: 'legacy-untrusted', patch: './cordis.patch.yml' },
    })
  })

  it('reads the legacy dsh.bundle patch path directly', () => {
    const legacy = parseLegacyBundleDeclaration(loadFixture('legacy-bundle'))
    expect(legacy).toEqual({ trust: 'legacy-untrusted', patch: './cordis.patch.yml' })
  })

  it('classifies a dsh field with neither manifestVersion nor bundle as missing', () => {
    expect(classifyPluginDeclaration({ profile: { bundles: [] } })).toEqual({ kind: 'missing' })
    expect(classifyPluginDeclaration(undefined)).toEqual({ kind: 'missing' })
  })

  it('classifies a malformed manifestVersion=2 field as missing rather than surfacing raw schema errors', () => {
    expect(classifyPluginDeclaration({ manifestVersion: 2 })).toEqual({ kind: 'missing' })
  })

  it('classifies a valid v2 manifest as manifest-v2', () => {
    const declaration = classifyPluginDeclaration(loadFixture('benign'))
    expect(declaration.kind).toBe('manifest-v2')
  })

  it('denies legacy-untrusted and missing declarations in production by default', () => {
    expect(isDeniedInProductionByDefault({ kind: 'missing' })).toBe(true)
    expect(isDeniedInProductionByDefault({
      kind: 'legacy-untrusted',
      legacy: { trust: 'legacy-untrusted', patch: './cordis.patch.yml' },
    })).toBe(true)
  })

  it('does not deny a valid manifest-v2 declaration in production by default', () => {
    const manifest = loadFixture('benign') as PluginManifestV2
    expect(isDeniedInProductionByDefault({ kind: 'manifest-v2', manifest })).toBe(false)
  })
})

describe('JSON Schema golden fixtures and backward compatibility (ajv, draft 2020-12)', () => {
  it('parses spec/capability-manifest.schema.json as a valid draft 2020-12 schema', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(typeof validateAgainstSchema).toBe('function')
  })

  it('validates the benign fixture against the JSON Schema document', () => {
    expect(validateAgainstSchema(loadFixture('benign'))).toBe(true)
  })

  it('validates the overprivileged fixture against the JSON Schema document', () => {
    expect(validateAgainstSchema(loadFixture('overprivileged'))).toBe(true)
  })

  it('rejects the undeclared-tool fixture against the JSON Schema document', () => {
    expect(validateAgainstSchema(loadFixture('undeclared-tool'))).toBe(false)
  })

  it('rejects the undeclared-network fixture against the JSON Schema document', () => {
    expect(validateAgainstSchema(loadFixture('undeclared-network'))).toBe(false)
  })

  it('agrees with the hand-written TypeScript validator on every fixture', () => {
    const fixtures = ['benign', 'overprivileged', 'undeclared-tool', 'undeclared-network']
    for (const name of fixtures) {
      const fixture = loadFixture(name)
      const tsResult = validatePluginManifestV2(fixture)
      const schemaResult = validateAgainstSchema(fixture)
      expect(tsResult.valid).toBe(schemaResult)
    }
  })
})

/** A JSON-serializable object nested `depth` levels deep under one leaf key. */
function buildDeeplyNestedValue(depth: number): unknown {
  let value: unknown = { leaf: true }
  for (let i = 0; i < depth; i++) value = { nested: value }
  return value
}

describe('Epic P1-01.F: fault injection against the real, already-shipped validator', () => {
  it('does not crash with an uncaught RangeError on a manifest carrying a deeply nested field anywhere in the raw value', () => {
    // assertJsonSerializable walks the WHOLE raw value unconditionally (not
    // just must[0]'s known fields), recursively, with no depth limit -- a
    // manifest whose JSON structure is merely deep (not large) previously
    // overflowed Node's call stack well within a realistic attacker's reach
    // (empirically ~5,000 levels; this asserts headroom well past that).
    const manifest = { manifestVersion: 2, x: buildDeeplyNestedValue(50_000) }
    expect(() => validatePluginManifestV2(manifest)).not.toThrow()
    expect(() => classifyPluginDeclaration(manifest)).not.toThrow()
  })

  it('reports a deeply nested field as an ordinary validation outcome, not a crash, and denies it production admission', () => {
    const manifest = { manifestVersion: 2, x: buildDeeplyNestedValue(10_000) }
    const result = validatePluginManifestV2(manifest)
    // manifestVersion:2 with no other must[0] fields fails schema validation
    // on those missing fields -- the deep nesting itself contributes no
    // error (nothing in the schema forbids depth), it only used to crash.
    expect(result.valid).toBe(false)
    // classifyPluginDeclaration folds any invalid manifestVersion:2 shape to
    // 'missing' (validate.ts's own documented behavior): a deeply nested
    // attacker-controlled manifest is denied production admission, not
    // silently admitted and not a process crash that would take an entire
    // profile boot down with it.
    expect(classifyPluginDeclaration(manifest)).toEqual({ kind: 'missing' })
  })

  it('still detects a real wildcard finding on an otherwise-valid manifest that also carries an unrelated deeply nested field', () => {
    const raw = {
      manifestVersion: 2,
      tools: [{
        name: 'deep-tool', sideEffectClass: 'network', authAudience: ['model'],
        allowedDestinations: [{ kind: 'network', hostPattern: '*' }], dataClassification: 'internal',
      }],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
      // An unknown top-level property: the schema does not close objects to
      // unknown properties (already-disclosed limitation) -- this only
      // confirms depth alone no longer crashes an otherwise-valid manifest.
      extra: buildDeeplyNestedValue(10_000),
    }
    const result = validatePluginManifestV2(raw)
    expect(result.valid).toBe(true)
    if (result.valid) expect(detectWildcardPermissions(result.manifest)).toHaveLength(1)
  })

  it('reports multiple assertJsonSerializable violations inside one array in true left-to-right index order, even when an undefined element sits before a nested violation at a later index', () => {
    // assertJsonSerializable's explicit work-stack walk must reproduce the
    // original recursive implementation's error ordering (an unpinned
    // regression here previously shipped silently: the array branch pushed
    // an undefined element's error eagerly during the parent frame's own
    // scan, ahead of a deferred nested-violation child at an earlier index).
    const raw = {
      manifestVersion: 2,
      x: [{ deep: { violation: () => {} } }, undefined, 'ok'],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }
    const result = validatePluginManifestV2(raw)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toEqual([
        { path: 'x[0].deep.violation', message: 'must be static JSON data, not a function — manifests are never generated by executing package code' },
        { path: 'x[1]', message: 'array elements must not be undefined — JSON.parse can never produce this' },
      ])
    }
  })

  it('handles a large (50,000-entry) tools array without crashing or taking unreasonable time', () => {
    const tools = Array.from({ length: 50_000 }, (_, i) => ({
      name: `tool-${i}`, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal',
    }))
    const manifest = {
      manifestVersion: 2, tools, executionMode: 'in-process', compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }
    const start = Date.now()
    const result = validatePluginManifestV2(manifest)
    expect(result.valid).toBe(true)
    expect(Date.now() - start).toBeLessThan(5000)
  })

  it('classifies __proto__/constructor/hasOwnProperty used as ordinary tool names without prototype pollution or misbehavior', () => {
    const dangerousNames = ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString']
    const manifest = {
      manifestVersion: 2,
      tools: dangerousNames.map(name => ({
        name, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal',
      })),
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }
    const result = validatePluginManifestV2(manifest)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.manifest.tools?.map(tool => tool.name)).toEqual(dangerousNames)
    }
    // Object.prototype itself must stay unaffected by any of this module's
    // own property access (Object.entries/isRecord never write a key back).
    expect(Object.prototype.hasOwnProperty.call({}, '__proto__')).toBe(false)
  })

  it('does not crash on unicode, control-character, and zero-width strings in free-text fields', () => {
    const nasty = 'RTL‮evil‬ null﻿zwnj emoji\u{1F600} "quote\\" \'x\'=1; DROP TABLE plugins;--'
    const manifest = {
      manifestVersion: 2,
      dataStores: [{ domainName: nasty, dataClassification: 'internal' }],
      secrets: [{ key: nasty, reason: nasty }],
      services: [{ ctxKey: nasty, role: 'provides' }],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }
    const result = validatePluginManifestV2(manifest)
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.manifest.dataStores?.[0]?.domainName).toBe(nasty)
  })

  const EMPTY_OBSERVED: ObservedPluginCapabilities = { ctxKeys: [], toolNames: [], skillNames: [], mcpServerNames: [], eventNames: [] }

  it('does not double-count a duplicate declared tool name against a single matching observation (Set-identity comparison)', () => {
    // A manifest that (illegally under most schemas, but this validator does
    // not reject duplicate array entries) declares the same tool name twice
    // with different effect fields must not inflate the mismatch count --
    // compareDeclaredToObserved compares by name via Set, so a duplicate
    // collapses to one declared name either way.
    const manifest: PluginManifestV2 = {
      manifestVersion: 2,
      tools: [
        { name: 'dup', sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal' },
        { name: 'dup', sideEffectClass: 'destructive', authAudience: ['service'], allowedDestinations: [], dataClassification: 'secret' },
      ],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }
    const comparison = compareDeclaredToObserved(manifest, { ...EMPTY_OBSERVED, toolNames: ['dup'] })
    expect(comparison.mismatches).toEqual([])
    expect(decidePluginTrust(comparison)).toBe('active')
  })

  it('does not double-count duplicate observed tool names against a single declared name', () => {
    const manifest: PluginManifestV2 = {
      manifestVersion: 2,
      tools: [{ name: 'once', sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal' }],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }
    const comparison = compareDeclaredToObserved(manifest, { ...EMPTY_OBSERVED, toolNames: ['once', 'once', 'once'] })
    expect(comparison.mismatches).toEqual([])
  })

  it('compares __proto__/constructor/hasOwnProperty capability names correctly in both mismatch directions (no Set/property-access confusion)', () => {
    const dangerousNames = ['__proto__', 'constructor', 'hasOwnProperty', 'toString']
    const manifest: PluginManifestV2 = {
      manifestVersion: 2,
      tools: dangerousNames.map(name => ({
        name, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal',
      })),
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }
    // Every declared dangerous name is actually observed: no mismatch.
    const matching = compareDeclaredToObserved(manifest, { ...EMPTY_OBSERVED, toolNames: dangerousNames })
    expect(matching.mismatches).toEqual([])
    // None of the declared dangerous names were observed, and one extra
    // dangerous name was observed but never declared: every one of the four
    // declared names is reported missing, plus the one undeclared extra --
    // proves the comparison genuinely inspects each name rather than
    // short-circuiting on an inherited Object.prototype member.
    const mismatched = compareDeclaredToObserved(manifest, { ...EMPTY_OBSERVED, toolNames: ['valueOf'] })
    expect(mismatched.mismatches).toHaveLength(dangerousNames.length + 1)
    expect(mismatched.mismatches).toEqual(expect.arrayContaining([
      { kind: 'undeclared-registration', category: 'tool', name: 'valueOf' },
      ...dangerousNames.map(name => ({ kind: 'declared-not-registered', category: 'tool', name })),
    ]))
  })

  it('handles a large (50,000-entry) observed capability set without crashing or taking unreasonable time', () => {
    const manifest: PluginManifestV2 = {
      manifestVersion: 2,
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }
    const toolNames = Array.from({ length: 50_000 }, (_, i) => `observed-tool-${i}`)
    const start = Date.now()
    const comparison = compareDeclaredToObserved(manifest, { ...EMPTY_OBSERVED, toolNames })
    expect(comparison.mismatches).toHaveLength(50_000)
    expect(Date.now() - start).toBeLessThan(5000)
  })

  it('evaluatePreMountAdmission denies a deeply nested manifest-shaped declaration the same as any other malformed manifest, never crashing pre-mount admission', () => {
    const raw = { manifestVersion: 2, x: buildDeeplyNestedValue(20_000) }
    const declaration = classifyPluginDeclaration(raw)
    expect(declaration.kind).toBe('missing')
    expect(() => evaluatePreMountAdmission(declaration, true)).not.toThrow()
    expect(evaluatePreMountAdmission(declaration, true)).toEqual({ admitted: false, reason: 'missing-manifest', wildcardFindings: [] })
  })
})
