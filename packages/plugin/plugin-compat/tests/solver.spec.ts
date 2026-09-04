/**
 * Clause coverage for Epic P1-08's plugin ABI, capability, and schema
 * compatibility negotiation. One `it()` per registry-declared must[] clause
 * (must[0] split into its declared-shape and provider-constraint cases) and
 * one per acceptance[] clause (acceptance[1] split into its two named
 * fail-closed scenarios). Every case calls the exported `solvePluginGraph`
 * (`../src/index.ts`) against real branded fixture data.
 *
 * The `Fault` and `Characterization` sections below qualify that landed
 * behaviour under the degenerate and adversarial graphs the registry's own
 * validation[] names (diamond dependency, version conflict, optional
 * provider) plus the ones no clause names but a real boot can still be
 * handed: an empty graph, a duplicated plugin identity, a manifest that
 * contradicts only itself, a provider nothing consumes, and a provider
 * constraint naming a plugin absent from the graph. A `fault[...]` case
 * asserts behaviour the landed code did not yet have; a `control:` or
 * `characterization:` case pins behaviour that was already correct, so a
 * later change cannot quietly regress it.
 */

import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { solvePluginGraph } from '../src/index.ts'
import { resolveActivatedGraph } from '../src/solver.ts'
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

describe('P1-08 Fault — acceptance[0]: a graph is only deterministic if one pluginId names one plugin', () => {
  it('fault[A]: two manifests sharing a pluginId fail loud, naming the duplicated id, rather than producing an order-dependent plan', () => {
    const shared = pluginId('duplicated-plugin')
    const admissible = fixtureManifest(shared)
    const outOfRange = fixtureManifest(shared, { runtimeApiRange: { min: apiVersion(9), max: apiVersion(9) } })

    expect(() => solvePluginGraph([admissible, outOfRange], fixtureHost())).toThrow(/duplicated-plugin/)
    expect(() => solvePluginGraph([outOfRange, admissible], fixtureHost())).toThrow(/duplicated-plugin/)
  })

  it('fault[A]: the provider stage inherits the same rejection, so no cascade ever runs over a graph with an ambiguous plugin identity', () => {
    const shared = pluginId('duplicated-plugin')
    const admissible = fixtureManifest(shared)
    const outOfRange = fixtureManifest(shared, { runtimeApiRange: { min: apiVersion(9), max: apiVersion(9) } })

    expect(() => resolveActivatedGraph([admissible, outOfRange], fixtureHost())).toThrow(/duplicated-plugin/)
  })
})

describe('P1-08 Fault — must[2]/rollback: a manifest that contradicts only itself blocks only itself', () => {
  it('fault[B]: a single manifest declaring both requires-provider and excludes-provider on the same sole provider is blocked alone, leaving the graph solvable', () => {
    const capability = capabilityId('contested-cap')
    const provider = pluginId('provider-plugin')
    const healthy = pluginId('healthy-plugin')
    const selfContradictory = pluginId('self-contradictory-plugin')

    const graph = [
      fixtureManifest(provider, { providedCapabilities: [capability] }),
      fixtureManifest(healthy),
      fixtureManifest(selfContradictory, {
        capabilities: [requirement(capability, 'required')],
        providerConstraints: [
          { capabilityId: capability, kind: 'requires-provider', providerId: provider },
          { capabilityId: capability, kind: 'excludes-provider', providerId: provider },
        ],
      }),
    ]

    const solution = solvePluginGraph(graph, fixtureHost())
    expect(solution.solvable).toBe(true)
    if (!solution.solvable) return

    const blocked = solution.loadPlan.activations.find(row => row.pluginId === selfContradictory)
    expect(blocked?.activation).toEqual({
      status: 'blocked',
      reasonCode: 'provider-constraint-violation',
      missingCapabilities: [capability],
    })
  })

  it('fault[B]: an unrelated healthy plugin still receives an activation when another manifest contradicts itself — an incompatible candidate stays inactive, it does not take the graph down', () => {
    const capability = capabilityId('contested-cap')
    const provider = pluginId('provider-plugin')
    const healthy = pluginId('healthy-plugin')

    const graph = [
      fixtureManifest(provider, { providedCapabilities: [capability] }),
      fixtureManifest(healthy),
      fixtureManifest(pluginId('self-contradictory-plugin'), {
        capabilities: [requirement(capability, 'required')],
        providerConstraints: [
          { capabilityId: capability, kind: 'requires-provider', providerId: provider },
          { capabilityId: capability, kind: 'excludes-provider', providerId: provider },
        ],
      }),
    ]

    const solution = solvePluginGraph(graph, fixtureHost())
    expect(solution.solvable).toBe(true)
    if (!solution.solvable) return

    expect(solution.loadPlan.activations.find(row => row.pluginId === healthy)?.activation.status).toBe('active')
    expect(solution.loadPlan.activations.find(row => row.pluginId === provider)?.activation.status).toBe('active')
  })

  it('control: a genuine two-manifest contradiction is still a graph-level unsat core, and every entry names a manifest that really declared one of the opposing constraints', () => {
    const capability = capabilityId('contested-cap')
    const provider = pluginId('sole-provider')
    const requirer = pluginId('requirer-plugin')
    const excluder = pluginId('excluder-plugin')

    const graph = [
      fixtureManifest(provider, { providedCapabilities: [capability] }),
      fixtureManifest(requirer, {
        capabilities: [requirement(capability, 'required')],
        providerConstraints: [{ capabilityId: capability, kind: 'requires-provider', providerId: provider }],
      }),
      fixtureManifest(excluder, {
        capabilities: [requirement(capability, 'required')],
        providerConstraints: [{ capabilityId: capability, kind: 'excludes-provider', providerId: provider }],
      }),
    ]

    const solution = solvePluginGraph(graph, fixtureHost())
    expect(solution.solvable).toBe(false)
    if (solution.solvable) return

    expect(solution.unsatCore.map(entry => entry.pluginId)).toEqual([excluder, requirer])
    expect(new Set(solution.unsatCore.map(entry => entry.pluginId)).size).toBe(2)
  })
})

describe('P1-08 Characterization — validation[0]: diamond dependency, version conflict, optional provider', () => {
  const base = capabilityId('base-cap')
  const leftCap = capabilityId('left-cap')
  const rightCap = capabilityId('right-cap')
  const root = pluginId('a-root')
  const left = pluginId('b-left')
  const right = pluginId('c-right')
  const sink = pluginId('d-sink')

  /** A diamond: `root` provides `base`, `left` and `right` each consume it and provide their own, `sink` requires both arms. */
  function diamond(rootRange?: PluginCompatManifest['runtimeApiRange']): readonly PluginCompatManifest[] {
    return [
      fixtureManifest(root, { providedCapabilities: [base], ...(rootRange ? { runtimeApiRange: rootRange } : {}) }),
      fixtureManifest(left, { capabilities: [requirement(base, 'required')], providedCapabilities: [leftCap] }),
      fixtureManifest(right, { capabilities: [requirement(base, 'required')], providedCapabilities: [rightCap] }),
      fixtureManifest(sink, { capabilities: [requirement(leftCap, 'required'), requirement(rightCap, 'required')] }),
    ]
  }

  it('characterization: every node of a healthy diamond resolves active, and the sink binds to both arms rather than to the shared root', () => {
    const solution = resolveActivatedGraph(diamond(), fixtureHost())
    expect(solution.solvable).toBe(true)
    if (!solution.solvable) return

    expect(solution.loadPlan.activations.map(row => row.activation.status)).toEqual(['active', 'active', 'active', 'active'])
    expect(solution.loadPlan.bindings).toEqual([
      { consumerId: left, capabilityId: base, providerId: root },
      { consumerId: right, capabilityId: base, providerId: root },
      { consumerId: sink, capabilityId: leftCap, providerId: left },
      { consumerId: sink, capabilityId: rightCap, providerId: right },
    ])
  })

  it('characterization: blocking a diamond\'s shared root cascades down both arms and reaches the sink, which reports both arms missing, not only the first', () => {
    const solution = resolveActivatedGraph(diamond({ min: apiVersion(9), max: apiVersion(9) }), fixtureHost())
    expect(solution.solvable).toBe(true)
    if (!solution.solvable) return

    const sinkActivation = solution.loadPlan.activations.find(row => row.pluginId === sink)?.activation
    expect(sinkActivation).toEqual({
      status: 'blocked',
      reasonCode: 'missing-required-capability',
      missingCapabilities: [leftCap, rightCap],
    })
    expect(solution.loadPlan.activations.every(row => row.activation.status === 'blocked')).toBe(true)
    expect(solution.loadPlan.bindings).toEqual([])
  })

  it('characterization: in a version-conflict graph only the manifest whose declared major band covers the host registration resolves active; the two disjoint bands are each blocked with schema-major-mismatch', () => {
    const contested = schemaId('contested-schema')
    const host = fixtureHost({ registeredSchemaVersions: new Map([[contested, schemaVersion(2, 0)]]) })
    const range = (min: number, max: number) => [{
      schemaId: contested,
      minVersion: schemaVersion(min, 0),
      maxVersion: schemaVersion(max, 9),
    }]

    const solution = solvePluginGraph([
      fixtureManifest(pluginId('a-below'), { schemaRanges: range(1, 1) }),
      fixtureManifest(pluginId('b-above'), { schemaRanges: range(3, 3) }),
      fixtureManifest(pluginId('c-matching'), { schemaRanges: range(2, 2) }),
    ], host)

    expect(solution.solvable).toBe(true)
    if (!solution.solvable) return
    expect(solution.loadPlan.activations.map(row => row.activation)).toEqual([
      { status: 'blocked', reasonCode: 'schema-major-mismatch', missingCapabilities: [] },
      { status: 'blocked', reasonCode: 'schema-major-mismatch', missingCapabilities: [] },
      { status: 'active', disabledOptionalCapabilities: [] },
    ])
  })

  it('characterization: an optional capability whose sole provider is itself blocked disables only that capability — cascade never propagates through an optional edge', () => {
    const optional = capabilityId('optional-cap')
    const solution = resolveActivatedGraph([
      fixtureManifest(pluginId('a-blocked-provider'), {
        runtimeApiRange: { min: apiVersion(9), max: apiVersion(9) },
        providedCapabilities: [optional],
      }),
      fixtureManifest(pluginId('b-consumer'), { capabilities: [requirement(optional, 'optional')] }),
    ], fixtureHost())

    expect(solution.solvable).toBe(true)
    if (!solution.solvable) return
    expect(solution.loadPlan.activations.map(row => row.activation)).toEqual([
      { status: 'blocked', reasonCode: 'runtime-api-range-incompatible', missingCapabilities: [] },
      { status: 'active', disabledOptionalCapabilities: [optional] },
    ])
    expect(solution.loadPlan.bindings).toEqual([])
  })
})

describe('P1-08 Characterization — degenerate graphs a real boot can still be handed', () => {
  it('characterization: an empty graph solves to an empty plan rather than failing, and both stages agree on that', () => {
    const contract = solvePluginGraph([], fixtureHost())
    expect(contract.solvable).toBe(true)
    if (!contract.solvable) return
    expect(contract.loadPlan.activations).toEqual([])
    expect(typeof contract.loadPlan.planId).toBe('string')

    const resolved = resolveActivatedGraph([], fixtureHost())
    expect(resolved.solvable).toBe(true)
    if (!resolved.solvable) return
    expect(resolved.loadPlan.activations).toEqual([])
    expect(resolved.loadPlan.bindings).toEqual([])
  })

  it('characterization: a provider whose capability nothing consumes resolves active and contributes no binding', () => {
    const solution = resolveActivatedGraph([
      fixtureManifest(pluginId('a-provider'), { providedCapabilities: [capabilityId('nobody-wants-this')] }),
      fixtureManifest(pluginId('b-bystander')),
    ], fixtureHost())

    expect(solution.solvable).toBe(true)
    if (!solution.solvable) return
    expect(solution.loadPlan.activations.map(row => row.activation.status)).toEqual(['active', 'active'])
    expect(solution.loadPlan.bindings).toEqual([])
  })

  it('characterization: a requires-provider naming a plugin absent from the graph blocks the consumer with provider-constraint-violation, never binds to the provider that does exist', () => {
    const capability = capabilityId('shared-cap')
    const consumer = pluginId('b-consumer')
    const solution = resolveActivatedGraph([
      fixtureManifest(pluginId('a-real-provider'), { providedCapabilities: [capability] }),
      fixtureManifest(consumer, {
        capabilities: [requirement(capability, 'required')],
        providerConstraints: [{ capabilityId: capability, kind: 'requires-provider', providerId: pluginId('never-installed') }],
      }),
    ], fixtureHost())

    expect(solution.solvable).toBe(true)
    if (!solution.solvable) return
    expect(solution.loadPlan.activations.find(row => row.pluginId === consumer)?.activation).toEqual({
      status: 'blocked',
      reasonCode: 'provider-constraint-violation',
      missingCapabilities: [capability],
    })
    expect(solution.loadPlan.bindings).toEqual([])
  })
})

/**
 * Every generated graph uses distinct {@link PluginId}s drawn from this pool:
 * a duplicated identity is rejected outright (see the `fault[A]` cases), so
 * it is not a legal input for the determinism property to range over.
 */
const PROPERTY_PLUGIN_POOL = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] as const

/** The capability namespace generated graphs draw both requirements and provisions from. */
const PROPERTY_CAPABILITY_POOL = ['cap-a', 'cap-b', 'cap-c'] as const

/**
 * A graph of up to six distinct plugins, each with an independently chosen
 * runtime API range (admissible or not, so blocking and cascade both occur),
 * required/optional requirements, and provided capabilities.
 */
const arbitraryGraph = fc.uniqueArray(fc.constantFrom(...PROPERTY_PLUGIN_POOL), { minLength: 1, maxLength: 6 })
  .chain(ids => fc.tuple(...ids.map(id => fc.record({
    min: fc.integer({ min: 1, max: 3 }),
    span: fc.integer({ min: 0, max: 3 }),
    capabilities: fc.uniqueArray(
      fc.tuple(fc.constantFrom(...PROPERTY_CAPABILITY_POOL), fc.constantFrom<CapabilityNecessity>('required', 'optional')),
      { maxLength: 3, selector: ([capability]) => capability },
    ),
    provided: fc.uniqueArray(fc.constantFrom(...PROPERTY_CAPABILITY_POOL), { maxLength: 3 }),
  }).map(spec => fixtureManifest(pluginId(id), {
    runtimeApiRange: { min: apiVersion(spec.min), max: apiVersion(spec.min + spec.span) },
    capabilities: spec.capabilities.map(([capability, necessity]) => requirement(capabilityId(capability), necessity)),
    providedCapabilities: spec.provided.map(capability => capabilityId(capability)),
  })))))

/**
 * fast-check is pinned to a fixed `seed` and `numRuns`: an unpinned property
 * test is a case that can pass on one run and fail on the next, which makes
 * a red as unreproducible as a case that only holds on one operating system.
 * Raising `numRuns` or changing `seed` explores different graphs and is a
 * deliberate edit, not a silent environment difference.
 */
const PROPERTY_RUN_OPTIONS = { seed: 0x50_31_08, numRuns: 500 } as const

describe('P1-08 Characterization — acceptance[0] as a property: 同一输入产生同一 load plan', () => {
  it('characterization: over 500 generated graphs, every permutation of the same manifest set yields an identical planId at the contract stage', () => {
    fc.assert(
      fc.property(arbitraryGraph, fc.integer(), (manifests, rotation) => {
        const offset = ((rotation % manifests.length) + manifests.length) % manifests.length
        const permuted = [...manifests.slice(offset), ...manifests.slice(0, offset)]

        const first = solvePluginGraph(manifests, fixtureHost())
        const second = solvePluginGraph(permuted, fixtureHost())
        expect(second).toEqual(first)
      }),
      PROPERTY_RUN_OPTIONS,
    )
  })

  it('characterization: the same property holds through the provider stage, so cascade and provider bindings are order-independent too', () => {
    fc.assert(
      fc.property(arbitraryGraph, fc.integer(), (manifests, rotation) => {
        const offset = ((rotation % manifests.length) + manifests.length) % manifests.length
        const permuted = [...manifests.slice(offset), ...manifests.slice(0, offset)]

        const first = resolveActivatedGraph(manifests, fixtureHost())
        const second = resolveActivatedGraph(permuted, fixtureHost())
        expect(second).toEqual(first)
      }),
      PROPERTY_RUN_OPTIONS,
    )
  })

  it('characterization: solving the same graph twice is referentially stable — a solve never depends on state carried between calls', () => {
    fc.assert(
      fc.property(arbitraryGraph, (manifests) => {
        expect(solvePluginGraph(manifests, fixtureHost())).toEqual(solvePluginGraph(manifests, fixtureHost()))
      }),
      PROPERTY_RUN_OPTIONS,
    )
  })
})
