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

import type {
  CapabilityId,
  HostCompatContext,
  PluginActivation,
  PluginCompatManifest,
  PluginId,
  RuntimeApiVersion,
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
  throw new Error(`not implemented: resolveHostCompatContext(${runtimeApiVersion})`)
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
  throw new Error(
    `not implemented: resolveActivatedGraph(${manifests.length} manifests, runtimeApiVersion=${host.runtimeApiVersion})`,
  )
}
