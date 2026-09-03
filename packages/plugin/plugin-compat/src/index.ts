/**
 * Contract-stage type surface and whole-graph solver signature for Epic
 * P1-08's plugin ABI, capability, and schema compatibility negotiation:
 * what a plugin manifest declares about its runtime API range, schema
 * ranges, required/optional capabilities, and provider constraints
 * (must[0]); the single entry point that solves every declared manifest
 * together before boot, never one plugin at a time (must[1]); the minimal
 * unsat core a genuine graph-level conflict reports (must[2]); and the
 * structural guarantee that a missing required or security-critical
 * capability can only ever be reported, never silently caught and treated
 * as present (must[3]).
 *
 * **Grounding.** This module is a new negotiation axis, not an extension of
 * `@deepseek-ai/dsh-plugin-manifest`'s `PluginManifestV2` (Epic P1-01,
 * predecessor). `PluginManifestV2.compatibility.dshVersionRange` is a single
 * semver-range string over the whole harness version and
 * `PluginManifestV2.services`' `ServiceCapabilityDeclaration` records a bare
 * `ctxKey`/`role` pair for permission auditing — neither carries a
 * structured range, a required-vs-optional split, or a provider constraint,
 * and P1-01's own must[]/acceptance[] never mention any of the four. This
 * module fixes that separate vocabulary instead of overloading P1-01's:
 * {@link RuntimeApiVersion}/{@link RuntimeApiRange} mirror this repo's
 * existing monotonic-integer version convention
 * (`SCHEMA_VERSION`/`SESSION_FORMAT_VERSION`, see root `CLAUDE.md`) rather
 * than a semver string, so a solver can compare ranges without parsing;
 * {@link SchemaRangeRequirement} reuses `@deepseek-ai/dsh-schema-registry`'s
 * own {@link SchemaId}/{@link SchemaVersion} rather than redeclaring
 * major/minor; {@link ProviderConstraint} grounds "provider" in this repo's
 * own capability-seam vocabulary (`docs/glossary.md#capability-seam`'s
 * Service Definition/Service Provider/Consumer roles — `dsh-bash-local` and
 * `dsh-bash-sandbox` are two providers of the same `dsh-shell` Service
 * Definition, the concrete precedent a required capability's provider
 * constraint narrows against).
 *
 * **Whole-graph, not lazy (must[1]).** {@link solvePluginGraph} is this
 * package's one exported operation: it takes every plugin's
 * {@link PluginCompatManifest} at once and returns one
 * {@link PluginGraphSolution} covering the whole graph. There is no
 * per-plugin `resolveOne` alternative in this module — a caller cannot
 * accidentally load a plugin the whole-graph solve has not yet considered.
 *
 * **No silent degradation (must[3]).** {@link PluginActivationStatus} is a
 * closed two-variant union: `'active'` never carries a `missingCapabilities`
 * field, and `'blocked'` never carries a `disabledOptionalCapabilities`
 * field — there is no third, partial variant representing "active with a
 * required or security-critical capability silently absent." A caller
 * cannot construct that state by mistake, and `solvePluginGraph`'s eventual
 * real implementation cannot return it by catching an internal error and
 * falling back to `'active'`: the return type has no slot for that outcome
 * to occupy.
 *
 * This slice is Contract-stage only: {@link solvePluginGraph} has a real,
 * epic-accurate signature but throws `'not implemented'` unconditionally —
 * the real whole-graph constraint solver is `src/solver.ts`'s later
 * Provider-stage deliverable, not this module's.
 *
 * @module @deepseek-ai/dsh-plugin-compat
 */

import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { SchemaId, SchemaVersion } from '@deepseek-ai/dsh-schema-registry/types'

export type { SchemaId, SchemaVersion } from '@deepseek-ai/dsh-schema-registry/types'

/**
 * A plugin package's stable identity for compatibility solving: its npm
 * package name, mirroring `@deepseek-ai/dsh-host-plugin-inventory`'s
 * `PluginPackageIdentity.name` (this package does not import that host
 * package — a `PluginId` is the same real-world fact, named locally to
 * avoid a host→plugin dependency cycle, since Inventory is the consumer of
 * this module's solved output, not the other way around).
 */
export type PluginId = Branded<'PluginId'>

/**
 * A capability's stable identity within the compatibility graph — the same
 * kind of real-world fact as a Cordis `ctx` key or
 * `@deepseek-ai/dsh-plugin-manifest`'s `ServiceCapabilityDeclaration.ctxKey`,
 * but branded here because {@link solvePluginGraph} compares
 * `CapabilityId`s directly against each other (must[0]'s
 * required/optional/provided lists, {@link ProviderConstraint.capabilityId})
 * and a bare `string` would let an unrelated identifier collide by
 * construction — this repo's opaque-cross-boundary-id rule.
 */
export type CapabilityId = Branded<'CapabilityId'>

/**
 * This build's runtime API version, a monotonic integer mirroring this
 * repo's existing `SCHEMA_VERSION`/`SESSION_FORMAT_VERSION` convention
 * rather than a semver string (see this module's own grounding note) — a
 * solver compares two `RuntimeApiVersion`s with plain integer ordering, no
 * range-string parser required.
 */
export type RuntimeApiVersion = BrandedNumber<'RuntimeApiVersion'>

/**
 * must[0]'s "runtime API range": the inclusive `[min, max]` band of
 * {@link RuntimeApiVersion} a manifest declares itself compatible with.
 * `min` and `max` may be equal (a manifest pinned to exactly one runtime API
 * version).
 */
export interface RuntimeApiRange {
  readonly min: RuntimeApiVersion
  readonly max: RuntimeApiVersion
}

/**
 * must[0]'s "schema ranges": the inclusive `[minVersion, maxVersion]` band
 * of {@link SchemaVersion} a manifest declares itself compatible with for
 * one `@deepseek-ai/dsh-schema-registry` {@link SchemaId}. `minVersion` and
 * `maxVersion` share the same `schemaId`; a manifest names one
 * `SchemaRangeRequirement` per schema it depends on, not a single range
 * spanning unrelated schemas.
 */
export interface SchemaRangeRequirement {
  readonly schemaId: SchemaId
  readonly minVersion: SchemaVersion
  readonly maxVersion: SchemaVersion
}

/** must[0]'s required-vs-optional split for one declared capability dependency. */
export type CapabilityNecessity = 'required' | 'optional'

/**
 * must[0]'s per-capability declaration: one capability this plugin depends
 * on, whether it is required or optional (acceptance[1]/acceptance[2]
 * hinge on this split), and whether it is security-critical (must[3]).
 * `securityCritical` is always present, never inferred from `necessity`
 * alone — an optional capability is never security-critical by
 * construction (see {@link solvePluginGraph}'s JSDoc), and marking a
 * required capability security-critical is this manifest's own explicit
 * claim, not a default a solver guesses at.
 */
export interface CapabilityRequirement {
  readonly capabilityId: CapabilityId
  readonly necessity: CapabilityNecessity
  /**
   * Whether a missing required capability is a security capability must[3]
   * forbids downgrading through a caught exception, rather than an ordinary
   * feature dependency. Meaningless (and always `false`) when
   * `necessity` is `'optional'` — an optional capability's absence is
   * acceptance[2]'s explicit feature-disable path, never a security
   * concern this solver fails closed over.
   */
  readonly securityCritical: boolean
}

/**
 * must[0]'s "provider constraints": how a required or optional capability
 * narrows which {@link PluginId} may back it, when more than one provider
 * of the same capability could be present in the graph (this repo's
 * capability-seam vocabulary, `docs/glossary.md#capability-seam` — the
 * `dsh-bash-local` vs. `dsh-bash-sandbox` precedent for `dsh-shell`).
 * `'requires-provider'` admits only the named `providerId`, whether or not
 * other providers of `capabilityId` are present; `'excludes-provider'`
 * admits any provider of `capabilityId` except the named one.
 */
export type ProviderConstraintKind = 'requires-provider' | 'excludes-provider'

/** One provider-narrowing constraint a manifest declares against one of its capability dependencies. */
export interface ProviderConstraint {
  readonly capabilityId: CapabilityId
  readonly kind: ProviderConstraintKind
  readonly providerId: PluginId
}

/**
 * must[0]'s complete declaration: one plugin's runtime API range, schema
 * ranges, required/optional capability dependencies, provider constraints
 * against those dependencies, and the capabilities this plugin itself
 * provides to the rest of the graph. `providedCapabilities` is what makes
 * {@link solvePluginGraph} a graph solve rather than an isolated per-plugin
 * check: another manifest's {@link CapabilityRequirement} or
 * {@link ProviderConstraint} is only satisfiable against the union of every
 * manifest's `providedCapabilities` in the same call.
 */
export interface PluginCompatManifest {
  readonly pluginId: PluginId
  readonly runtimeApiRange: RuntimeApiRange
  readonly schemaRanges: readonly SchemaRangeRequirement[]
  readonly capabilities: readonly CapabilityRequirement[]
  readonly providerConstraints: readonly ProviderConstraint[]
  readonly providedCapabilities: readonly CapabilityId[]
}

/**
 * The host build's own facts {@link solvePluginGraph} solves every manifest
 * against: the running {@link RuntimeApiVersion}, and the
 * {@link SchemaVersion} this build currently has registered per
 * {@link SchemaId} (the same identity/version pairs
 * `@deepseek-ai/dsh-schema-registry`'s `listSchemas()` returns, reduced to
 * the fields a range comparison needs — this module does not import that
 * package's runtime registry, only its `./types` subpath, so constructing a
 * `HostCompatContext` never has the side effect of bootstrapping the real
 * schema registry).
 */
export interface HostCompatContext {
  readonly runtimeApiVersion: RuntimeApiVersion
  readonly registeredSchemaVersions: ReadonlyMap<SchemaId, SchemaVersion>
}

/**
 * Why one {@link PluginCompatManifest} constraint could not be satisfied —
 * symmetric with must[0]'s four declared field categories, one code per
 * category, so a conflict is always attributable to a specific declared
 * field rather than a generic failure.
 */
export type ConflictReasonCode =
  /** The host's {@link HostCompatContext.runtimeApiVersion} falls outside a manifest's {@link RuntimeApiRange}. */
  | 'runtime-api-range-incompatible'
  /**
   * A {@link SchemaRangeRequirement}'s major does not cover the host's
   * registered major for that {@link SchemaId} — must[2]/acceptance[1]'s
   * "major schema 不匹配".
   */
  | 'schema-major-mismatch'
  /**
   * No manifest in the graph provides a {@link CapabilityRequirement} with
   * `necessity: 'required'`, after {@link ProviderConstraint}s are applied.
   */
  | 'missing-required-capability'
  /** A {@link ProviderConstraint} rules out every candidate provider the graph otherwise offers for `capabilityId`. */
  | 'provider-constraint-violation'

/**
 * must[2]'s minimal unsat core: one entry per {@link PluginCompatManifest}
 * constraint that participates in a graph-level contradiction —
 * {@link solvePluginGraph} includes an entry only when removing it (or the
 * manifest it belongs to) would change whether the graph is solvable,
 * never every manifest merely present in the same solve call. A plugin
 * whose own constraints are all independently satisfiable never appears
 * here, even when it shares the graph with an unrelated conflict.
 */
export interface UnsatCoreConstraint {
  readonly pluginId: PluginId
  readonly reasonCode: ConflictReasonCode
  /**
   * The specific `CapabilityId`, `SchemaId`, or provider `PluginId` this
   * constraint names, identifying which declared field of `pluginId`'s
   * manifest is part of the conflict.
   */
  readonly constraintRef: string
  /**
   * Human-readable explanation of why this constraint is part of the
   * minimal contradictory set — must[2] forbids a bare "failed" with no
   * attribution.
   */
  readonly detail: string
}

/** must[2]'s minimal unsat core: the smallest set of {@link UnsatCoreConstraint}s that together make the graph unsolvable. */
export type UnsatCore = readonly UnsatCoreConstraint[]

/**
 * One plugin's outcome within a solved {@link LoadPlan} (acceptance[1]/
 * acceptance[2]). The two variants are mutually exclusive by construction:
 * `'active'` never carries `missingCapabilities` (nothing required or
 * security-critical is absent), and `'blocked'` never carries
 * `disabledOptionalCapabilities` (a blocked plugin's code never executes at
 * all, so no individual feature distinction inside it is meaningful) — see
 * this module's own grounding note on why no third, partially-active
 * variant exists.
 */
export type PluginActivationStatus =
  | {
    readonly status: 'active'
    /**
     * acceptance[2]: every optional {@link CapabilityId} this plugin
     * declared that no provider in the graph supplies, shown explicitly
     * rather than left for a caller to discover by omission.
     */
    readonly disabledOptionalCapabilities: readonly CapabilityId[]
  }
  | {
    readonly status: 'blocked'
    readonly reasonCode: ConflictReasonCode
    /**
     * Every required {@link CapabilityId} (security-critical or not) this
     * plugin declared that the graph does not satisfy — acceptance[1]'s
     * "不执行插件代码" applies to the whole plugin, not a per-capability
     * degradation.
     */
    readonly missingCapabilities: readonly CapabilityId[]
  }

/** One row of a solved {@link LoadPlan}: a plugin's identity paired with its {@link PluginActivationStatus}. */
export interface PluginActivation {
  readonly pluginId: PluginId
  readonly activation: PluginActivationStatus
}

/**
 * acceptance[0]'s deterministic solve result: one {@link PluginActivation}
 * per manifest {@link solvePluginGraph} was called with, plus a `planId`
 * that is equal across two calls given equal `manifests`/`host` inputs —
 * the concrete, comparable fact "same input, same load plan" reduces to.
 */
export interface LoadPlan {
  readonly activations: readonly PluginActivation[]
  /**
   * Deterministic identity of this exact solve outcome — equal
   * `manifests`/`host` inputs always produce an equal `planId`
   * (acceptance[0]).
   */
  readonly planId: string
}

/**
 * {@link solvePluginGraph}'s result: either every manifest was placed into a
 * {@link LoadPlan} (individual plugins may still be `'blocked'` inside it —
 * see {@link PluginActivationStatus}), or the graph as a whole contains a
 * genuine mutual contradiction no per-plugin blocking can resolve, reported
 * as a minimal {@link UnsatCore} (must[2]).
 */
export type PluginGraphSolution =
  | { readonly solvable: true; readonly loadPlan: LoadPlan }
  | { readonly solvable: false; readonly unsatCore: UnsatCore }

/**
 * must[1]'s boot-time entry point: solve every `manifests` entry together
 * against `host` in one call, returning either a complete {@link LoadPlan}
 * or a minimal {@link UnsatCore} (must[2]). This is the only exported
 * operation this package offers — there is no per-plugin alternative a
 * caller could use instead of passing the whole graph, so a caller cannot
 * activate a plugin this function has not considered together with every
 * other plugin in the same boot.
 * @param manifests - every plugin's {@link PluginCompatManifest} the current
 *   boot considers, in any order — the result does not depend on array
 *   order (acceptance[0]).
 * @param host - the current build's {@link HostCompatContext} every
 *   manifest is solved against.
 * @returns a {@link PluginGraphSolution}: `solvable: true` with one
 *   {@link PluginActivation} per `manifests` entry, or `solvable: false`
 *   with the minimal {@link UnsatCore}.
 */
export function solvePluginGraph(manifests: readonly PluginCompatManifest[], host: HostCompatContext): PluginGraphSolution {
  throw new Error(`not implemented: solvePluginGraph(${String(manifests.length)} manifests, hostRuntimeApiVersion=${String(host.runtimeApiVersion)})`)
}
