/**
 * Provider-stage resolution for Epic P1-08's compatibility negotiation: the
 * two things a real boot needs that `./index.ts`'s Contract-stage
 * {@link solvePluginGraph} deliberately does not do.
 *
 * **Real host facts, not caller-supplied ones (must[0]'s "schema ranges").**
 * `./index.ts` imports only `@deepseek-ai/dsh-schema-registry/types` and
 * takes the host's registered schema majors as a plain
 * {@link HostCompatContext} parameter, so constructing one never bootstraps
 * the real registry. That is correct for a pure solver and useless for a
 * real boot, which must solve against the schemas this build actually
 * registered. {@link resolveHostCompatContext} closes that gap by reading
 * the live registry through its real exported `listSchemas()`, never a
 * mirrored copy of the registration list.
 *
 * **Provider assignment and cascade (must[1]/must[3]).**
 * {@link solvePluginGraph} treats a {@link CapabilityRequirement} as
 * satisfied whenever some manifest in the graph *declares* the capability in
 * its `providedCapabilities`, regardless of whether that provider itself
 * resolves active. That is sound for one solve pass and unsound for a boot:
 * a plugin blocked on its own runtime API range never loads, so its declared
 * capabilities never exist at runtime, and a consumer activated against them
 * would reach a missing capability after boot — precisely the silent
 * degradation must[3] forbids for a security-critical dependency.
 * {@link resolveActivatedGraph} runs the graph to a fixpoint so blocking
 * propagates along the real provider edges, and records the concrete
 * {@link ProviderBinding} each satisfied requirement resolved to, which the
 * Contract-stage {@link LoadPlan} does not carry.
 *
 * Graph-level unsatisfiability is not re-derived here: this module delegates
 * to {@link solvePluginGraph} for the minimal {@link UnsatCore} (must[2])
 * and for each manifest's own runtime-API/schema/provider-constraint verdict,
 * then resolves bindings and cascades on top of that result.
 *
 * @module @deepseek-ai/dsh-plugin-compat/solver
 */

import { listSchemas } from '@deepseek-ai/dsh-schema-registry'
import { solvePluginGraph } from './index.ts'
import type {
  CapabilityId,
  HostCompatContext,
  PluginActivation,
  PluginCompatManifest,
  PluginId,
  RuntimeApiVersion,
  SchemaId,
  SchemaVersion,
  UnsatCore,
} from './index.ts'

/**
 * One resolved provider edge: which graph member actually satisfies one
 * consumer's declared dependency on one capability. The Contract-stage
 * {@link LoadPlan} records only that a requirement was satisfied; a boot
 * needs the identity of the provider it was satisfied by, both to wire the
 * capability seam and to make {@link resolveActivatedGraph}'s cascade
 * auditable.
 */
export interface ProviderBinding {
  /** The plugin whose {@link PluginCompatManifest.capabilities} declared the dependency. */
  readonly consumerId: PluginId
  /** The capability the dependency named. */
  readonly capabilityId: CapabilityId
  /** The active graph member whose `providedCapabilities` satisfies it. */
  readonly providerId: PluginId
}

/**
 * A fully resolved boot plan: the Contract-stage activations after cascade,
 * plus the {@link ProviderBinding} every satisfied requirement resolved to.
 */
export interface ResolvedLoadPlan {
  /**
   * One {@link PluginActivation} per solved manifest, ordered by
   * {@link PluginId}, with cascade applied — a plugin active in the
   * Contract-stage plan appears here as `'blocked'` when every provider of
   * one of its required capabilities is itself blocked.
   */
  readonly activations: readonly PluginActivation[]
  /**
   * Every resolved provider edge, ordered by `consumerId` then
   * `capabilityId`. Only an `'active'` consumer contributes bindings, and
   * only to an `'active'` provider — a blocked plugin's edges are never
   * listed as if they would be wired.
   */
  readonly bindings: readonly ProviderBinding[]
  /**
   * Deterministic identity of this exact resolved outcome, covering both
   * `activations` and `bindings` — equal graphs produce an equal `planId`
   * regardless of `manifests` array order.
   */
  readonly planId: string
}

/**
 * {@link resolveActivatedGraph}'s result: a resolved boot plan, or the same
 * minimal {@link UnsatCore} the Contract-stage solve reported (must[2]) —
 * a graph-level contradiction is never masked by cascade.
 */
export type ResolvedGraphSolution =
  | { readonly solvable: true; readonly loadPlan: ResolvedLoadPlan }
  | { readonly solvable: false; readonly unsatCore: UnsatCore }

/**
 * must[0]'s "schema ranges", resolved from the real
 * `@deepseek-ai/dsh-schema-registry` rather than supplied by the caller:
 * every schema this build has actually registered, at its current registered
 * version, paired with the caller's own runtime API version (which the
 * schema registry knows nothing about).
 * @param runtimeApiVersion - this build's runtime API version, carried
 *   through to {@link HostCompatContext.runtimeApiVersion} unchanged.
 * @returns a {@link HostCompatContext} whose `registeredSchemaVersions` has
 *   exactly one entry per live registration, at that registration's current
 *   version.
 */
export function resolveHostCompatContext(runtimeApiVersion: RuntimeApiVersion): HostCompatContext {
  const registeredSchemaVersions = new Map<SchemaId, SchemaVersion>()
  for (const registration of listSchemas()) {
    registeredSchemaVersions.set(registration.schemaId, registration.version)
  }
  return { runtimeApiVersion, registeredSchemaVersions }
}

/**
 * Every {@link PluginId} whose `providedCapabilities` names a given
 * {@link CapabilityId} — the graph's "who could satisfy this" index, before
 * any consumer's own {@link ProviderConstraint}s or the cascade's
 * still-active set narrow it.
 */
function indexProviders(manifests: readonly PluginCompatManifest[]): Map<CapabilityId, PluginId[]> {
  const index = new Map<CapabilityId, PluginId[]>()
  for (const manifest of manifests) {
    for (const capabilityId of manifest.providedCapabilities) {
      const providers = index.get(capabilityId)
      if (providers) providers.push(manifest.pluginId)
      else index.set(capabilityId, [manifest.pluginId])
    }
  }
  return index
}

/**
 * The still-active providers `consumer` may bind to for `capabilityId`,
 * sorted lexicographically so the smallest eligible {@link PluginId} is
 * first regardless of `manifests` array order: the graph's providers of
 * `capabilityId`, narrowed by `consumer`'s own {@link ProviderConstraint}s
 * (`'requires-provider'` keeps only its named providers,
 * `'excludes-provider'` removes its named ones) and by `active`.
 */
function eligibleProviders(
  consumer: PluginCompatManifest,
  capabilityId: CapabilityId,
  providedBy: ReadonlyMap<CapabilityId, readonly PluginId[]>,
  active: ReadonlySet<PluginId>,
): readonly PluginId[] {
  const own = consumer.providerConstraints.filter(constraint => constraint.capabilityId === capabilityId)
  const required = new Set(own.filter(constraint => constraint.kind === 'requires-provider').map(constraint => constraint.providerId))
  const excluded = new Set(own.filter(constraint => constraint.kind === 'excludes-provider').map(constraint => constraint.providerId))

  return (providedBy.get(capabilityId) ?? [])
    .filter(providerId =>
      active.has(providerId)
      && (required.size === 0 || required.has(providerId))
      && !excluded.has(providerId))
    .sort(comparePluginId)
}

/** Stable, content-only ordering for two {@link PluginId}s. */
function comparePluginId(a: PluginId, b: PluginId): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Resolve the whole graph to a boot-ready plan: take the Contract-stage
 * {@link solvePluginGraph} verdict, then propagate blocking along real
 * provider edges to a fixpoint and record the surviving
 * {@link ProviderBinding}s.
 *
 * A required capability counts as satisfied only when at least one
 * *still-active* graph member both provides it and is admitted by the
 * consumer's own {@link ProviderConstraint}s; when none is, the consumer is
 * blocked with `missing-required-capability`, whether or not the requirement
 * is `securityCritical` — must[3] leaves no partially-active outcome for a
 * security capability to degrade into. An unsatisfied *optional* capability
 * is listed in the consumer's `disabledOptionalCapabilities` and never
 * blocks it, so cascade does not propagate through optional edges.
 *
 * Where more than one active provider is admissible, the binding is the
 * lexicographically smallest {@link PluginId}, so the plan does not depend
 * on `manifests` array order.
 * @param manifests - every plugin's {@link PluginCompatManifest} this boot
 *   considers, in any order.
 * @param host - the build's host facts, normally from
 *   {@link resolveHostCompatContext}.
 * @returns a {@link ResolvedGraphSolution}: the resolved plan, or the
 *   Contract-stage minimal {@link UnsatCore}.
 */
export function resolveActivatedGraph(
  manifests: readonly PluginCompatManifest[],
  host: HostCompatContext,
): ResolvedGraphSolution {
  const base = solvePluginGraph(manifests, host)
  if (!base.solvable) return base

  const byId = new Map(manifests.map(manifest => [manifest.pluginId, manifest] as const))
  const providedBy = indexProviders(manifests)

  // Greatest fixpoint: start from every Contract-stage-active plugin and
  // remove those whose required capabilities have no still-active admissible
  // provider, until a pass removes nothing. Removal is one-way, so the loop
  // runs at most once per plugin and a provider cycle whose members satisfy
  // each other survives — a cycle is not a cascade.
  const active = new Set<PluginId>()
  for (const row of base.loadPlan.activations) {
    if (row.activation.status === 'active') active.add(row.pluginId)
  }

  for (let changed = true; changed;) {
    changed = false
    for (const pluginId of [...active]) {
      const manifest = byId.get(pluginId)
      if (!manifest) continue
      const unsatisfied = manifest.capabilities.some(requirement =>
        requirement.necessity === 'required'
        && eligibleProviders(manifest, requirement.capabilityId, providedBy, active).length === 0)
      if (unsatisfied) {
        active.delete(pluginId)
        changed = true
      }
    }
  }

  const activations: PluginActivation[] = []
  const bindings: ProviderBinding[] = []

  for (const row of base.loadPlan.activations) {
    const manifest = byId.get(row.pluginId)
    if (row.activation.status === 'blocked' || !manifest) {
      activations.push(row)
      continue
    }

    const missingCapabilities: CapabilityId[] = []
    const disabledOptionalCapabilities: CapabilityId[] = []
    const resolved: ProviderBinding[] = []
    for (const requirement of manifest.capabilities) {
      const [providerId] = eligibleProviders(manifest, requirement.capabilityId, providedBy, active)
      if (providerId !== undefined) {
        resolved.push({ consumerId: manifest.pluginId, capabilityId: requirement.capabilityId, providerId })
      } else if (requirement.necessity === 'required') {
        missingCapabilities.push(requirement.capabilityId)
      } else {
        disabledOptionalCapabilities.push(requirement.capabilityId)
      }
    }

    if (active.has(manifest.pluginId)) {
      activations.push({ pluginId: manifest.pluginId, activation: { status: 'active', disabledOptionalCapabilities } })
      bindings.push(...resolved)
    } else {
      activations.push({
        pluginId: manifest.pluginId,
        activation: { status: 'blocked', reasonCode: 'missing-required-capability', missingCapabilities },
      })
    }
  }

  bindings.sort((a, b) =>
    comparePluginId(a.consumerId, b.consumerId)
    || (a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0))

  return { solvable: true, loadPlan: { activations, bindings, planId: computeResolvedPlanId(activations, bindings) } }
}

/**
 * Deterministic identity of a {@link ResolvedLoadPlan}: a stable
 * serialization of both already-sorted `activations` and `bindings` (with
 * each activation's own capability-id lists sorted), so equal graphs produce
 * an equal `planId` regardless of `manifests` array order.
 */
function computeResolvedPlanId(
  activations: readonly PluginActivation[],
  bindings: readonly ProviderBinding[],
): string {
  const canonicalActivations = activations.map(row => ({
    pluginId: row.pluginId,
    activation: row.activation.status === 'active'
      ? { status: 'active' as const, disabledOptionalCapabilities: [...row.activation.disabledOptionalCapabilities].sort() }
      : {
        status: 'blocked' as const,
        reasonCode: row.activation.reasonCode,
        missingCapabilities: [...row.activation.missingCapabilities].sort(),
      },
  }))
  return JSON.stringify({ activations: canonicalActivations, bindings })
}
