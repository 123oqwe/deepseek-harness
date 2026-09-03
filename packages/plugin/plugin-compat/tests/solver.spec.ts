/**
 * Clause coverage for Epic P1-08's plugin ABI, capability, and schema
 * compatibility negotiation. One `it()` per registry-declared must[] clause
 * (must[0] split into its declared-shape and provider-constraint cases) and
 * one per acceptance[] clause (acceptance[1] split into its two named
 * fail-closed scenarios). Every case calls the exported `solvePluginGraph`
 * (`../src/index.ts`) against real branded fixture data.
 */

import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { solvePluginGraph } from '../src/index.ts'
import type {
  CapabilityId,
  CapabilityNecessity,
  CapabilityRequirement,
  HostCompatContext,
  PluginCompatManifest,
  PluginId,
  RuntimeApiVersion,
  SchemaId,
  SchemaVersion,
} from '../src/index.ts'

function apiVersion(value: number): RuntimeApiVersion {
  return brandNumber<RuntimeApiVersion>(value)
}

function pluginId(name: string): PluginId {
  return brandString<PluginId>(name)
}

function capabilityId(name: string): CapabilityId {
  return brandString<CapabilityId>(name)
}

function schemaId(name: string): SchemaId {
  return brandString<SchemaId>(name)
}

function schemaVersion(major: number, minor: number): SchemaVersion {
  return { major, minor }
}

function requirement(id: CapabilityId, necessity: CapabilityNecessity, securityCritical = false): CapabilityRequirement {
  return { capabilityId: id, necessity, securityCritical }
}

/** Build a fixture {@link PluginCompatManifest} with permissive defaults, overriding only the fields a case cares about. */
function fixtureManifest(id: PluginId, overrides: Partial<Omit<PluginCompatManifest, 'pluginId'>> = {}): PluginCompatManifest {
  return {
    pluginId: id,
    runtimeApiRange: overrides.runtimeApiRange ?? { min: apiVersion(1), max: apiVersion(5) },
    schemaRanges: overrides.schemaRanges ?? [],
    capabilities: overrides.capabilities ?? [],
    providerConstraints: overrides.providerConstraints ?? [],
    providedCapabilities: overrides.providedCapabilities ?? [],
  }
}

/** Default {@link HostCompatContext}: runtime API version 2, no schemas registered — cases needing a registered schema build their own. */
function fixtureHost(overrides: Partial<HostCompatContext> = {}): HostCompatContext {
  return {
    runtimeApiVersion: overrides.runtimeApiVersion ?? apiVersion(2),
    registeredSchemaVersions: overrides.registeredSchemaVersions ?? new Map(),
  }
}

describe('P1-08 Contract — must clauses', () => {
  it('must[0]: a manifest declaring runtime API range, schema ranges, a satisfied required capability, and a satisfied requires-provider constraint resolves active with no disabled optional capabilities', () => {
    const sharedService = capabilityId('shared-service')
    const provider = pluginId('provider-plugin')
    const main = pluginId('main-plugin')
    const coreSchema = schemaId('core-schema')

    const providerManifest = fixtureManifest(provider, {
      providedCapabilities: [sharedService, capabilityId('extra-feature')],
    })
    const mainManifest = fixtureManifest(main, {
      runtimeApiRange: { min: apiVersion(1), max: apiVersion(3) },
      schemaRanges: [{ schemaId: coreSchema, minVersion: schemaVersion(1, 0), maxVersion: schemaVersion(1, 99) }],
      capabilities: [requirement(sharedService, 'required'), requirement(capabilityId('extra-feature'), 'optional')],
      providerConstraints: [{ capabilityId: sharedService, kind: 'requires-provider', providerId: provider }],
    })
    const host = fixtureHost({ registeredSchemaVersions: new Map([[coreSchema, schemaVersion(1, 2)]]) })

    const solution = solvePluginGraph([providerManifest, mainManifest], host)
    expect(solution.solvable).toBe(true)
    if (solution.solvable) {
      expect(solution.loadPlan.activations).toHaveLength(2)
      const mainActivation = solution.loadPlan.activations.find(row => row.pluginId === main)
      expect(mainActivation?.activation.status).toBe('active')
      if (mainActivation?.activation.status === 'active') {
        expect(mainActivation.activation.disabledOptionalCapabilities).toEqual([])
      }
    }
  })

  it('must[0]: an excludes-provider constraint still resolves active when a different provider of the same capability remains eligible', () => {
    const sharedService = capabilityId('shared-service')
    const goodProvider = pluginId('provider-good')
    const badProvider = pluginId('provider-bad')
    const main = pluginId('main-plugin')

    const goodManifest = fixtureManifest(goodProvider, { providedCapabilities: [sharedService] })
    const badManifest = fixtureManifest(badProvider, { providedCapabilities: [sharedService] })
    const mainManifest = fixtureManifest(main, {
      capabilities: [requirement(sharedService, 'required')],
      providerConstraints: [{ capabilityId: sharedService, kind: 'excludes-provider', providerId: badProvider }],
    })

    const solution = solvePluginGraph([goodManifest, badManifest, mainManifest], fixtureHost())
    expect(solution.solvable).toBe(true)
    if (solution.solvable) {
      const mainActivation = solution.loadPlan.activations.find(row => row.pluginId === main)
      expect(mainActivation?.activation.status).toBe('active')
    }
  })

  it('must[1]: solving three independent manifests in one call resolves all three together, not one plugin at a time', () => {
    const manifestP = fixtureManifest(pluginId('plugin-p'))
    const manifestQ = fixtureManifest(pluginId('plugin-q'))
    const manifestR = fixtureManifest(pluginId('plugin-r'))

    const solution = solvePluginGraph([manifestP, manifestQ, manifestR], fixtureHost())
    expect(solution.solvable).toBe(true)
    if (solution.solvable) {
      const resolvedIds = new Set(solution.loadPlan.activations.map(row => row.pluginId))
      expect(resolvedIds).toEqual(new Set([manifestP.pluginId, manifestQ.pluginId, manifestR.pluginId]))
    }
  })

  it('must[2]: a direct requires-provider vs. excludes-provider contradiction over the graph\'s only provider yields a minimal unsat core, excluding an unrelated healthy plugin', () => {
    const sharedCap = capabilityId('shared-cap')
    const soleProvider = pluginId('sole-provider')
    const pluginA = pluginId('plugin-a')
    const pluginB = pluginId('plugin-b')
    const healthyPlugin = pluginId('healthy-plugin')

    const providerManifest = fixtureManifest(soleProvider, { providedCapabilities: [sharedCap] })
    const manifestA = fixtureManifest(pluginA, {
      capabilities: [requirement(sharedCap, 'required')],
      providerConstraints: [{ capabilityId: sharedCap, kind: 'requires-provider', providerId: soleProvider }],
    })
    const manifestB = fixtureManifest(pluginB, {
      capabilities: [requirement(sharedCap, 'required')],
      providerConstraints: [{ capabilityId: sharedCap, kind: 'excludes-provider', providerId: soleProvider }],
    })
    const manifestHealthy = fixtureManifest(healthyPlugin)

    const solution = solvePluginGraph([providerManifest, manifestA, manifestB, manifestHealthy], fixtureHost())
    expect(solution.solvable).toBe(false)
    if (!solution.solvable) {
      const conflictingPluginIds = new Set(solution.unsatCore.map(entry => entry.pluginId))
      expect(conflictingPluginIds.has(pluginA)).toBe(true)
      expect(conflictingPluginIds.has(pluginB)).toBe(true)
      expect(conflictingPluginIds.has(healthyPlugin)).toBe(false)
      expect(solution.unsatCore.every(entry => entry.reasonCode === 'provider-constraint-violation')).toBe(true)
    }
  })

  it('must[3]: a missing required security-critical capability always blocks the plugin, never resolves active with the capability silently absent', () => {
    const secureCap = capabilityId('secure-cap')
    const pluginA = pluginId('plugin-a')
    const healthyPlugin = pluginId('healthy-plugin')

    const manifestA = fixtureManifest(pluginA, {
      capabilities: [requirement(secureCap, 'required', true)],
    })
    const manifestHealthy = fixtureManifest(healthyPlugin)

    const solution = solvePluginGraph([manifestA, manifestHealthy], fixtureHost())
    expect(solution.solvable).toBe(true)
    if (solution.solvable) {
      const activationA = solution.loadPlan.activations.find(row => row.pluginId === pluginA)
      expect(activationA?.activation.status).toBe('blocked')
      if (activationA?.activation.status === 'blocked') {
        expect(activationA.activation.reasonCode).toBe('missing-required-capability')
        expect(activationA.activation.missingCapabilities).toContain(secureCap)
        // A 'blocked' activation structurally carries no disabledOptionalCapabilities
        // field — there is no partial "active but degraded" variant to fall into.
        expect('disabledOptionalCapabilities' in activationA.activation).toBe(false)
      }
    }
  })
})

describe('P1-08 Contract — acceptance[0]: 兼容图可确定性求解，同一输入产生同一 load plan', () => {
  it('solving two structurally-equal but distinct manifest/host inputs produces deep-equal load plans', () => {
    const buildManifests = (): readonly PluginCompatManifest[] => {
      const cap = capabilityId('shared-cap')
      const provider = fixtureManifest(pluginId('provider'), { providedCapabilities: [cap] })
      const consumer = fixtureManifest(pluginId('consumer'), { capabilities: [requirement(cap, 'required')] })
      return [provider, consumer]
    }
    const buildHost = (): HostCompatContext => fixtureHost()

    const first = solvePluginGraph(buildManifests(), buildHost())
    const second = solvePluginGraph(buildManifests(), buildHost())
    expect(first).toEqual(second)
  })
})

describe('P1-08 Contract — acceptance[1]: 缺少必需 capability 或 major schema 不匹配时不执行插件代码', () => {
  it('a plugin missing a (non-security) required capability is blocked, never active', () => {
    const neededCap = capabilityId('needed-cap')
    const main = pluginId('main-plugin')
    const manifest = fixtureManifest(main, { capabilities: [requirement(neededCap, 'required')] })

    const solution = solvePluginGraph([manifest], fixtureHost())
    expect(solution.solvable).toBe(true)
    if (solution.solvable) {
      const activation = solution.loadPlan.activations.find(row => row.pluginId === main)
      expect(activation?.activation.status).toBe('blocked')
      if (activation?.activation.status === 'blocked') {
        expect(activation.activation.reasonCode).toBe('missing-required-capability')
      }
    }
  })

  it('a plugin whose declared schema range major does not cover the host\'s registered major is blocked, never active', () => {
    const eventSchema = schemaId('event-schema')
    const main = pluginId('main-plugin')
    const manifest = fixtureManifest(main, {
      schemaRanges: [{ schemaId: eventSchema, minVersion: schemaVersion(2, 0), maxVersion: schemaVersion(2, 99) }],
    })
    const host = fixtureHost({ registeredSchemaVersions: new Map([[eventSchema, schemaVersion(1, 0)]]) })

    const solution = solvePluginGraph([manifest], host)
    expect(solution.solvable).toBe(true)
    if (solution.solvable) {
      const activation = solution.loadPlan.activations.find(row => row.pluginId === main)
      expect(activation?.activation.status).toBe('blocked')
      if (activation?.activation.status === 'blocked') {
        expect(activation.activation.reasonCode).toBe('schema-major-mismatch')
      }
    }
  })
})

describe('P1-08 Contract — acceptance[2]: 可选 capability 缺失时只禁用对应功能并明确展示', () => {
  it('a plugin missing only an optional capability stays active, with that capability explicitly listed as disabled', () => {
    const requiredCap = capabilityId('required-cap')
    const optionalCap = capabilityId('nice-to-have')
    const provider = pluginId('provider-plugin')
    const main = pluginId('main-plugin')

    const providerManifest = fixtureManifest(provider, { providedCapabilities: [requiredCap] })
    const mainManifest = fixtureManifest(main, {
      capabilities: [requirement(requiredCap, 'required'), requirement(optionalCap, 'optional')],
    })

    const solution = solvePluginGraph([providerManifest, mainManifest], fixtureHost())
    expect(solution.solvable).toBe(true)
    if (solution.solvable) {
      const activation = solution.loadPlan.activations.find(row => row.pluginId === main)
      expect(activation?.activation.status).toBe('active')
      if (activation?.activation.status === 'active') {
        expect(activation.activation.disabledOptionalCapabilities).toEqual([optionalCap])
      }
    }
  })
})
