/**
 * Epic P1-08.U's boot-time compatibility negotiation point in
 * `../src/profile.ts`: `readLayerCompatManifest` reads a real bundle
 * package's own `package.json` `dsh.compat` field (must[0]), and
 * `negotiateProfileLayerCompatibility` solves every declared layer together
 * before any patch is composed (must[1]), partitioning the profile's layers
 * into the ones a boot may compose and the ones whose plugin code must never
 * run (acceptance[1]/acceptance[2]).
 *
 * Every case stages real bundle packages on disk under a real profile
 * directory in an isolated temporary Harness home and drives them through
 * the real `loadProfile`, so the manifests under test come from real files
 * rather than hand-built objects.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { DSH_RUNTIME_API_VERSION } from '@deepseek-ai/dsh-plugin-compat'
import type {
  CapabilityId,
  HostCompatContext,
  PluginId,
  RuntimeApiVersion,
  SchemaId,
  SchemaVersion,
} from '@deepseek-ai/dsh-plugin-compat'
import {
  initProfile,
  loadProfile,
  negotiateProfileLayerCompatibility,
  readLayerCompatManifest,
  resolveProfileDir,
  type ProfileLayer,
} from '../src/profile.ts'

const BIN = 'profile-compat-test'

/** Temporary Harness homes this file created, removed after every case so a fork worker leaves nothing behind. */
const homes: string[] = []

/**
 * An isolated Harness home. `realpathSync` at creation is load-bearing, not
 * cosmetic: on macOS `os.tmpdir()` resolves through a `/var` -> `/private/var`
 * symlink that `profile.ts`'s own `realpathSync.native` calls would resolve
 * away, so an un-realpathed home yields path comparisons that hold on ext4
 * and fail on APFS.
 */
function home(): string {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'dsh-p1-08-compat-')))
  homes.push(dir)
  return dir
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop() as string, { recursive: true, force: true })
})

/** Stage one real bundle package under a profile's own `node_modules`, the second anchor `resolveBundleDir` searches. */
function stageBundle(profileDir: string, name: string, compat: unknown): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' }, ...compat === undefined ? {} : { compat } },
  }) + '\n')
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${name}-row\n      name: cordis:noop\n`)
}

/** Load the staged `demo` profile through the real loader and return its resolved bundle layers. */
function stagedProfileLayers(dir: string): readonly ProfileLayer[] {
  return loadProfile(BIN, 'demo', join(dir, 'package.json'), dir).layers
}

/** Create the `demo` profile directory inside an isolated home and return it. */
function stagedProfileDir(dir: string, bundles: readonly string[]): string {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-install-anchor', version: '1.0.0' }) + '\n')
  const profileDir = resolveProfileDir('demo', dir)
  initProfile(profileDir, bundles, 'startup')
  return profileDir
}

function capabilityId(name: string): CapabilityId {
  return brandString<CapabilityId>(name)
}

function pluginId(name: string): PluginId {
  return brandString<PluginId>(name)
}

function schemaVersion(major: number, minor: number): SchemaVersion {
  return { major, minor }
}

/** A host context pinned to this build's runtime API version with one registered schema, so cases control both axes. */
function hostContext(overrides: Partial<HostCompatContext> = {}): HostCompatContext {
  return {
    runtimeApiVersion: overrides.runtimeApiVersion ?? DSH_RUNTIME_API_VERSION,
    registeredSchemaVersions: overrides.registeredSchemaVersions
      ?? new Map<SchemaId, SchemaVersion>([[brandString<SchemaId>('session-log'), schemaVersion(3, 0)]]),
  }
}

/** A well-formed `dsh.compat` declaration with permissive defaults, overriding only the fields a case cares about. */
function compatDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runtimeApiRange: { min: 1, max: 5 },
    schemaRanges: [],
    capabilities: [],
    providerConstraints: [],
    providedCapabilities: [],
    ...overrides,
  }
}

describe('readLayerCompatManifest (must[0]: what a real package declares)', () => {
  it('reads runtime API range, schema ranges, required/optional capabilities, and provider constraints from a real package.json', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['declaring-bundle'])
    stageBundle(profileDir, 'declaring-bundle', compatDeclaration({
      runtimeApiRange: { min: 1, max: 2 },
      schemaRanges: [{ schemaId: 'session-log', minVersion: { major: 3, minor: 0 }, maxVersion: { major: 3, minor: 9 } }],
      capabilities: [
        { capabilityId: 'shell', necessity: 'required', securityCritical: true },
        { capabilityId: 'web-search', necessity: 'optional', securityCritical: false },
      ],
      providerConstraints: [{ capabilityId: 'shell', kind: 'excludes-provider', providerId: 'unsafe-shell' }],
      providedCapabilities: ['todo'],
    }))
    const [layer] = stagedProfileLayers(dir)
    expect(readLayerCompatManifest(layer as ProfileLayer)).toEqual({
      pluginId: pluginId('declaring-bundle'),
      runtimeApiRange: { min: brandNumber<RuntimeApiVersion>(1), max: brandNumber<RuntimeApiVersion>(2) },
      schemaRanges: [{
        schemaId: brandString<SchemaId>('session-log'),
        minVersion: schemaVersion(3, 0),
        maxVersion: schemaVersion(3, 9),
      }],
      capabilities: [
        { capabilityId: capabilityId('shell'), necessity: 'required', securityCritical: true },
        { capabilityId: capabilityId('web-search'), necessity: 'optional', securityCritical: false },
      ],
      providerConstraints: [{
        capabilityId: capabilityId('shell'),
        kind: 'excludes-provider',
        providerId: pluginId('unsafe-shell'),
      }],
      providedCapabilities: [capabilityId('todo')],
    })
  })

  it('returns undefined for a bundle package that declares no dsh.compat -- no declaration is not a constraint', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['silent-bundle'])
    stageBundle(profileDir, 'silent-bundle', undefined)
    const [layer] = stagedProfileLayers(dir)
    expect(readLayerCompatManifest(layer as ProfileLayer)).toBeUndefined()
  })

  it('must[3]: a malformed dsh.compat fails loud rather than degrading to unconstrained', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['broken-bundle'])
    stageBundle(profileDir, 'broken-bundle', compatDeclaration({
      capabilities: [{ capabilityId: 'shell', necessity: 'requried', securityCritical: true }],
    }))
    const [layer] = stagedProfileLayers(dir)
    expect(() => readLayerCompatManifest(layer as ProfileLayer)).toThrow(/dsh\.compat/)
  })
})

describe('negotiateProfileLayerCompatibility (must[1]/acceptance[1]/acceptance[2])', () => {
  it('admits every layer of a profile whose bundles declare no dsh.compat -- an existing profile composes unchanged', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['legacy-a', 'legacy-b'])
    stageBundle(profileDir, 'legacy-a', undefined)
    stageBundle(profileDir, 'legacy-b', undefined)
    const result = negotiateProfileLayerCompatibility(stagedProfileLayers(dir), hostContext())
    expect(result.solvable).toBe(true)
    if (!result.solvable) return
    expect(result.admitted.map(entry => entry.layer.packageName)).toEqual(['legacy-a', 'legacy-b'])
    expect(result.blocked).toEqual([])
    expect(result.admitted.every(entry => entry.activation.disabledOptionalCapabilities.length === 0)).toBe(true)
  })

  it('acceptance[1]: a layer whose required capability no layer provides is blocked, never admitted', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['needs-shell', 'healthy'])
    stageBundle(profileDir, 'needs-shell', compatDeclaration({
      capabilities: [{ capabilityId: 'shell', necessity: 'required', securityCritical: true }],
    }))
    stageBundle(profileDir, 'healthy', compatDeclaration({ providedCapabilities: ['todo'] }))
    const result = negotiateProfileLayerCompatibility(stagedProfileLayers(dir), hostContext())
    expect(result.solvable).toBe(true)
    if (!result.solvable) return
    expect(result.blocked.map(entry => entry.layer.packageName)).toEqual(['needs-shell'])
    expect(result.blocked[0]?.activation).toEqual({
      status: 'blocked',
      reasonCode: 'missing-required-capability',
      missingCapabilities: [capabilityId('shell')],
    })
    expect(result.admitted.map(entry => entry.layer.packageName)).toEqual(['healthy'])
  })

  it('acceptance[1]: a layer whose declared schema major does not cover the host registration is blocked', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['stale-schema'])
    stageBundle(profileDir, 'stale-schema', compatDeclaration({
      schemaRanges: [{ schemaId: 'session-log', minVersion: { major: 1, minor: 0 }, maxVersion: { major: 1, minor: 9 } }],
    }))
    const result = negotiateProfileLayerCompatibility(stagedProfileLayers(dir), hostContext())
    expect(result.solvable).toBe(true)
    if (!result.solvable) return
    expect(result.admitted).toEqual([])
    expect(result.blocked[0]?.activation.reasonCode).toBe('schema-major-mismatch')
  })

  it('acceptance[1]: a layer outside this build\'s runtime API range is blocked', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['future-abi'])
    stageBundle(profileDir, 'future-abi', compatDeclaration({ runtimeApiRange: { min: 99, max: 100 } }))
    const result = negotiateProfileLayerCompatibility(stagedProfileLayers(dir), hostContext())
    expect(result.solvable).toBe(true)
    if (!result.solvable) return
    expect(result.blocked[0]?.activation.reasonCode).toBe('runtime-api-range-incompatible')
  })

  it('acceptance[2]: a layer missing only an optional capability stays admitted, with that capability shown explicitly', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['optional-consumer'])
    stageBundle(profileDir, 'optional-consumer', compatDeclaration({
      capabilities: [{ capabilityId: 'web-search', necessity: 'optional', securityCritical: false }],
    }))
    const result = negotiateProfileLayerCompatibility(stagedProfileLayers(dir), hostContext())
    expect(result.solvable).toBe(true)
    if (!result.solvable) return
    expect(result.admitted[0]?.layer.packageName).toBe('optional-consumer')
    expect(result.admitted[0]?.activation.disabledOptionalCapabilities).toEqual([capabilityId('web-search')])
  })

  it('must[3]: cascade reaches the consumer -- a layer whose sole provider is itself blocked is blocked too, not admitted against a provider that never loads', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['blocked-provider', 'consumer'])
    stageBundle(profileDir, 'blocked-provider', compatDeclaration({
      runtimeApiRange: { min: 99, max: 100 },
      providedCapabilities: ['shell'],
    }))
    stageBundle(profileDir, 'consumer', compatDeclaration({
      capabilities: [{ capabilityId: 'shell', necessity: 'required', securityCritical: true }],
    }))
    const result = negotiateProfileLayerCompatibility(stagedProfileLayers(dir), hostContext())
    expect(result.solvable).toBe(true)
    if (!result.solvable) return
    expect(result.admitted).toEqual([])
    expect(result.blocked.map(entry => entry.layer.packageName).sort()).toEqual(['blocked-provider', 'consumer'])
  })

  it('must[2]: a graph-level requires/excludes contradiction over the sole provider returns the minimal unsat core, never a partition', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['requirer', 'excluder', 'sole-provider', 'bystander'])
    stageBundle(profileDir, 'requirer', compatDeclaration({
      capabilities: [{ capabilityId: 'shell', necessity: 'required', securityCritical: false }],
      providerConstraints: [{ capabilityId: 'shell', kind: 'requires-provider', providerId: 'sole-provider' }],
    }))
    stageBundle(profileDir, 'excluder', compatDeclaration({
      capabilities: [{ capabilityId: 'shell', necessity: 'required', securityCritical: false }],
      providerConstraints: [{ capabilityId: 'shell', kind: 'excludes-provider', providerId: 'sole-provider' }],
    }))
    stageBundle(profileDir, 'sole-provider', compatDeclaration({ providedCapabilities: ['shell'] }))
    stageBundle(profileDir, 'bystander', compatDeclaration({}))
    const result = negotiateProfileLayerCompatibility(stagedProfileLayers(dir), hostContext())
    expect(result.solvable).toBe(false)
    if (result.solvable) return
    expect(result.unsatCore.map(entry => entry.pluginId).sort()).toEqual([pluginId('excluder'), pluginId('requirer')])
    expect(result.unsatCore.every(entry => entry.reasonCode === 'provider-constraint-violation')).toBe(true)
  })

  it('acceptance[0]: the same profile negotiated twice produces the same planId and the same partition', () => {
    const dir = home()
    const profileDir = stagedProfileDir(dir, ['provider', 'consumer'])
    stageBundle(profileDir, 'provider', compatDeclaration({ providedCapabilities: ['shell'] }))
    stageBundle(profileDir, 'consumer', compatDeclaration({
      capabilities: [{ capabilityId: 'shell', necessity: 'required', securityCritical: true }],
    }))
    const layers = stagedProfileLayers(dir)
    const first = negotiateProfileLayerCompatibility(layers, hostContext())
    const second = negotiateProfileLayerCompatibility(layers, hostContext())
    expect(first.solvable).toBe(true)
    if (!first.solvable || !second.solvable) return
    expect(second.planId).toBe(first.planId)
    expect(second.admitted.map(entry => entry.layer.packageName)).toEqual(first.admitted.map(entry => entry.layer.packageName))
  })
})
