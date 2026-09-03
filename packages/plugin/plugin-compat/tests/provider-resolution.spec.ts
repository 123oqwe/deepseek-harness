/**
 * Provider-stage coverage for Epic P1-08. Every case here exercises
 * `../src/solver.ts`'s exports against real branded fixture data and,
 * for host-context resolution, against the real
 * `@deepseek-ai/dsh-schema-registry` runtime registry — never a parallel
 * mechanism and never a mirrored copy of the registration list.
 *
 * Scope split against the Contract-stage suite
 * (`./solver.spec.ts`): that suite proves `solvePluginGraph`'s per-manifest
 * verdicts, its minimal unsat core, and its plan determinism, all against a
 * caller-supplied `HostCompatContext` and a graph where a declared
 * `providedCapabilities` entry counts as satisfied regardless of whether its
 * provider loads. The cases below cover only what that leaves open: reading
 * the host's real registered schema majors, resolving which provider each
 * requirement actually binds to, and propagating blocking along those
 * provider edges to a fixpoint.
 */

import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { listSchemas } from '@deepseek-ai/dsh-schema-registry'
import { resolveActivatedGraph, resolveHostCompatContext } from '../src/solver.ts'
import type { ResolvedGraphSolution, ResolvedLoadPlan } from '../src/solver.ts'
import type {
  CapabilityId,
  CapabilityNecessity,
  CapabilityRequirement,
  HostCompatContext,
  PluginActivation,
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

function requirement(id: CapabilityId, necessity: CapabilityNecessity, securityCritical = false): CapabilityRequirement {
  return { capabilityId: id, necessity, securityCritical }
}

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

function fixtureHost(overrides: Partial<HostCompatContext> = {}): HostCompatContext {
  return {
    runtimeApiVersion: overrides.runtimeApiVersion ?? apiVersion(2),
    registeredSchemaVersions: overrides.registeredSchemaVersions ?? new Map(),
  }
}

/** The resolved plan of a solution the case expects to be solvable — fails the case loudly rather than silently skipping its assertions. */
function expectLoadPlan(solution: ResolvedGraphSolution): ResolvedLoadPlan {
  if (!solution.solvable) {
    throw new Error(`expected a solvable graph, got unsat core ${JSON.stringify(solution.unsatCore)}`)
  }
  return solution.loadPlan
}

/** One plugin's row in a resolved plan, by identity rather than by position. */
function activationOf(plan: ResolvedLoadPlan, id: PluginId): PluginActivation | undefined {
  return plan.activations.find(row => row.pluginId === id)
}

/**
 * A schemaId the real registry bootstraps at its first version, used to
 * pin `resolveHostCompatContext` to the live registration list.
 */
const REAL_SCHEMA_ID = schemaId('sdk-protocol:InitializeParams')
const REAL_SCHEMA_VERSION: SchemaVersion = { major: 1, minor: 0 }

describe('P1-08 Provider — host compatibility context resolved from the real schema registry (must[0])', () => {
  it('resolves one registeredSchemaVersions entry per live registration, at that registration\'s current version', () => {
    const live = listSchemas()
    const host = resolveHostCompatContext(apiVersion(2))

    expect(host.registeredSchemaVersions.size).toBe(live.length)
    for (const registration of live) {
      expect(host.registeredSchemaVersions.get(registration.schemaId)).toEqual(registration.version)
    }
  })

  it('reads the registry rather than a mirrored list: a schemaId the real registry bootstraps resolves to its registered version, and one it never registered is absent', () => {
    const host = resolveHostCompatContext(apiVersion(2))

    expect(host.registeredSchemaVersions.get(REAL_SCHEMA_ID)).toEqual(REAL_SCHEMA_VERSION)
    expect(host.registeredSchemaVersions.has(schemaId('sdk-protocol:NeverRegisteredParams'))).toBe(false)
  })

  it('carries the caller\'s runtime API version through unchanged — the schema registry contributes no runtime API fact', () => {
    expect(resolveHostCompatContext(apiVersion(4)).runtimeApiVersion).toBe(apiVersion(4))
  })

  it('a manifest whose schema range covers the real registry\'s registered major resolves active against the resolved host context', () => {
    const consumer = pluginId('schema-consumer')
    const host = resolveHostCompatContext(apiVersion(2))
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(consumer, {
        schemaRanges: [{ schemaId: REAL_SCHEMA_ID, minVersion: REAL_SCHEMA_VERSION, maxVersion: { major: 3, minor: 0 } }],
      }),
    ], host))

    expect(activationOf(plan, consumer)).toEqual({
      pluginId: consumer,
      activation: { status: 'active', disabledOptionalCapabilities: [] },
    })
  })

  it('the registered major is admitted at both inclusive range boundaries — a range pinned exactly to it resolves active', () => {
    const consumer = pluginId('pinned-schema-consumer')
    const host = resolveHostCompatContext(apiVersion(2))
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(consumer, {
        schemaRanges: [{ schemaId: REAL_SCHEMA_ID, minVersion: REAL_SCHEMA_VERSION, maxVersion: REAL_SCHEMA_VERSION }],
      }),
    ], host))

    expect(activationOf(plan, consumer)).toEqual({
      pluginId: consumer,
      activation: { status: 'active', disabledOptionalCapabilities: [] },
    })
  })

  it('a manifest whose schema range starts one major above the real registered major is blocked with schema-major-mismatch', () => {
    const consumer = pluginId('future-schema-consumer')
    const host = resolveHostCompatContext(apiVersion(2))
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(consumer, {
        schemaRanges: [{
          schemaId: REAL_SCHEMA_ID,
          minVersion: { major: REAL_SCHEMA_VERSION.major + 1, minor: 0 },
          maxVersion: { major: REAL_SCHEMA_VERSION.major + 2, minor: 0 },
        }],
      }),
    ], host))

    expect(activationOf(plan, consumer)).toEqual({
      pluginId: consumer,
      activation: { status: 'blocked', reasonCode: 'schema-major-mismatch', missingCapabilities: [] },
    })
  })
})

describe('P1-08 Provider — provider bindings and cascade over the whole graph (must[1], must[3])', () => {
  const shell = capabilityId('shell')
  const audit = capabilityId('audit')
  const telemetry = capabilityId('telemetry')

  it('an active provider produces an explicit binding naming the consumer, the capability, and the provider it resolved to', () => {
    const provider = pluginId('shell-provider')
    const consumer = pluginId('shell-consumer')
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(provider, { providedCapabilities: [shell] }),
      fixtureManifest(consumer, { capabilities: [requirement(shell, 'required')] }),
    ], fixtureHost()))

    expect(plan.bindings).toEqual([{ consumerId: consumer, capabilityId: shell, providerId: provider }])
    expect(activationOf(plan, consumer)).toEqual({
      pluginId: consumer,
      activation: { status: 'active', disabledOptionalCapabilities: [] },
    })
  })

  it('a consumer whose only required-capability provider is itself blocked is blocked too, never active against a provider that will not load', () => {
    const provider = pluginId('shell-provider')
    const consumer = pluginId('shell-consumer')
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(provider, {
        providedCapabilities: [shell],
        runtimeApiRange: { min: apiVersion(7), max: apiVersion(9) },
      }),
      fixtureManifest(consumer, { capabilities: [requirement(shell, 'required')] }),
    ], fixtureHost({ runtimeApiVersion: apiVersion(2) })))

    expect(activationOf(plan, consumer)).toEqual({
      pluginId: consumer,
      activation: { status: 'blocked', reasonCode: 'missing-required-capability', missingCapabilities: [shell] },
    })
    expect(plan.bindings).toEqual([])
  })

  it('a second, still-active provider of the same capability keeps the consumer active and binds to that survivor', () => {
    const blockedProvider = pluginId('a-blocked-provider')
    const liveProvider = pluginId('b-live-provider')
    const consumer = pluginId('shell-consumer')
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(blockedProvider, {
        providedCapabilities: [shell],
        runtimeApiRange: { min: apiVersion(7), max: apiVersion(9) },
      }),
      fixtureManifest(liveProvider, { providedCapabilities: [shell] }),
      fixtureManifest(consumer, { capabilities: [requirement(shell, 'required')] }),
    ], fixtureHost({ runtimeApiVersion: apiVersion(2) })))

    expect(plan.bindings).toEqual([{ consumerId: consumer, capabilityId: shell, providerId: liveProvider }])
    expect(activationOf(plan, consumer)).toEqual({
      pluginId: consumer,
      activation: { status: 'active', disabledOptionalCapabilities: [] },
    })
  })

  it('cascade reaches a three-plugin chain: blocking the root blocks both its direct and its indirect consumer, not only the first hop', () => {
    const root = pluginId('a-root')
    const middle = pluginId('b-middle')
    const leaf = pluginId('c-leaf')
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(root, {
        providedCapabilities: [shell],
        runtimeApiRange: { min: apiVersion(7), max: apiVersion(9) },
      }),
      fixtureManifest(middle, { capabilities: [requirement(shell, 'required')], providedCapabilities: [audit] }),
      fixtureManifest(leaf, { capabilities: [requirement(audit, 'required')] }),
    ], fixtureHost({ runtimeApiVersion: apiVersion(2) })))

    expect(activationOf(plan, middle)).toEqual({
      pluginId: middle,
      activation: { status: 'blocked', reasonCode: 'missing-required-capability', missingCapabilities: [shell] },
    })
    expect(activationOf(plan, leaf)).toEqual({
      pluginId: leaf,
      activation: { status: 'blocked', reasonCode: 'missing-required-capability', missingCapabilities: [audit] },
    })
    expect(plan.bindings).toEqual([])
  })

  it('a mutually-dependent provider pair, each satisfying the other\'s required capability, both resolve active — a cycle is not a cascade', () => {
    const first = pluginId('a-cycle-member')
    const second = pluginId('b-cycle-member')
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(first, { capabilities: [requirement(audit, 'required')], providedCapabilities: [shell] }),
      fixtureManifest(second, { capabilities: [requirement(shell, 'required')], providedCapabilities: [audit] }),
    ], fixtureHost()))

    expect(plan.activations).toEqual([
      { pluginId: first, activation: { status: 'active', disabledOptionalCapabilities: [] } },
      { pluginId: second, activation: { status: 'active', disabledOptionalCapabilities: [] } },
    ])
    expect(plan.bindings).toEqual([
      { consumerId: first, capabilityId: audit, providerId: second },
      { consumerId: second, capabilityId: shell, providerId: first },
    ])
  })

  it('must[3]: a security-critical required capability whose sole provider is blocked blocks the consumer, while a non-security optional capability with a blocked provider only disables that capability', () => {
    const auditProvider = pluginId('a-audit-provider')
    const telemetryProvider = pluginId('b-telemetry-provider')
    const securityConsumer = pluginId('c-security-consumer')
    const featureConsumer = pluginId('d-feature-consumer')
    const unreachable = { min: apiVersion(7), max: apiVersion(9) }
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(auditProvider, { providedCapabilities: [audit], runtimeApiRange: unreachable }),
      fixtureManifest(telemetryProvider, { providedCapabilities: [telemetry], runtimeApiRange: unreachable }),
      fixtureManifest(securityConsumer, { capabilities: [requirement(audit, 'required', true)] }),
      fixtureManifest(featureConsumer, { capabilities: [requirement(telemetry, 'optional')] }),
    ], fixtureHost({ runtimeApiVersion: apiVersion(2) })))

    expect(activationOf(plan, securityConsumer)).toEqual({
      pluginId: securityConsumer,
      activation: { status: 'blocked', reasonCode: 'missing-required-capability', missingCapabilities: [audit] },
    })
    expect(activationOf(plan, featureConsumer)).toEqual({
      pluginId: featureConsumer,
      activation: { status: 'active', disabledOptionalCapabilities: [telemetry] },
    })
    expect(plan.bindings).toEqual([])
  })

  it('a consumer\'s own excludes-provider constraint removes that provider from binding, resolving to the remaining eligible one', () => {
    const excluded = pluginId('a-excluded-provider')
    const allowed = pluginId('b-allowed-provider')
    const consumer = pluginId('c-consumer')
    const plan = expectLoadPlan(resolveActivatedGraph([
      fixtureManifest(excluded, { providedCapabilities: [shell] }),
      fixtureManifest(allowed, { providedCapabilities: [shell] }),
      fixtureManifest(consumer, {
        capabilities: [requirement(shell, 'required')],
        providerConstraints: [{ capabilityId: shell, kind: 'excludes-provider', providerId: excluded }],
      }),
    ], fixtureHost()))

    expect(plan.bindings).toEqual([{ consumerId: consumer, capabilityId: shell, providerId: allowed }])
  })

  it('among several eligible active providers the binding is the lexicographically smallest pluginId, not the first in the manifests array', () => {
    const consumer = pluginId('z-consumer')
    const manifests = [
      fixtureManifest(pluginId('m-provider'), { providedCapabilities: [shell] }),
      fixtureManifest(pluginId('a-provider'), { providedCapabilities: [shell] }),
      fixtureManifest(pluginId('t-provider'), { providedCapabilities: [shell] }),
      fixtureManifest(consumer, { capabilities: [requirement(shell, 'required')] }),
    ]

    expect(expectLoadPlan(resolveActivatedGraph(manifests, fixtureHost())).bindings).toEqual([
      { consumerId: consumer, capabilityId: shell, providerId: pluginId('a-provider') },
    ])
  })

  it('reordering the same graph produces a deep-equal resolved plan, planId and bindings included', () => {
    const provider = pluginId('a-provider')
    const consumer = pluginId('b-consumer')
    const spectator = pluginId('c-spectator')
    const manifests = [
      fixtureManifest(provider, { providedCapabilities: [shell] }),
      fixtureManifest(consumer, { capabilities: [requirement(shell, 'required'), requirement(telemetry, 'optional')] }),
      fixtureManifest(spectator),
    ]
    const host = fixtureHost()

    const forward = expectLoadPlan(resolveActivatedGraph(manifests, host))
    const reversed = expectLoadPlan(resolveActivatedGraph([...manifests].reverse(), host))

    expect(reversed).toEqual(forward)
    expect(forward.bindings).toEqual([{ consumerId: consumer, capabilityId: shell, providerId: provider }])
    expect(forward.activations).toEqual([
      { pluginId: provider, activation: { status: 'active', disabledOptionalCapabilities: [] } },
      { pluginId: consumer, activation: { status: 'active', disabledOptionalCapabilities: [telemetry] } },
      { pluginId: spectator, activation: { status: 'active', disabledOptionalCapabilities: [] } },
    ])
  })

  it('must[2] still takes precedence over cascade: a direct requires/excludes contradiction over the sole provider returns the minimal unsat core, never a resolved plan', () => {
    const soleProvider = pluginId('a-sole-provider')
    const requirer = pluginId('b-requirer')
    const excluder = pluginId('c-excluder')
    const solution = resolveActivatedGraph([
      fixtureManifest(soleProvider, { providedCapabilities: [shell] }),
      fixtureManifest(requirer, {
        capabilities: [requirement(shell, 'required')],
        providerConstraints: [{ capabilityId: shell, kind: 'requires-provider', providerId: soleProvider }],
      }),
      fixtureManifest(excluder, {
        capabilities: [requirement(shell, 'required')],
        providerConstraints: [{ capabilityId: shell, kind: 'excludes-provider', providerId: soleProvider }],
      }),
    ], fixtureHost())

    expect(solution.solvable).toBe(false)
    if (solution.solvable) return
    expect(solution.unsatCore.map(entry => entry.pluginId)).toEqual([requirer, excluder])
    expect(solution.unsatCore.every(entry => entry.reasonCode === 'provider-constraint-violation')).toBe(true)
  })
})
