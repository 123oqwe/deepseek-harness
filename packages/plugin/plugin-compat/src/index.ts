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
 * {@link solvePluginGraph} solves the whole graph directly in this module:
 * a pre-pass (`findProviderConstraintContradictions`) reports a direct
 * requires-provider/excludes-provider clash over a capability's sole
 * provider as a minimal {@link UnsatCore} (must[2]) before any per-manifest
 * activation is computed; absent such a clash, every manifest is solved
 * independently against the shared {@link HostCompatContext} and the
 * graph's declared `providedCapabilities` into a deterministic
 * {@link LoadPlan} (acceptance[0]).
 *
 * @module @deepseek-ai/dsh-plugin-compat
 */

import { brandNumber } from '@deepseek-ai/dsh-brand'
import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { SchemaId, SchemaVersion } from '@deepseek-ai/dsh-schema-registry/types'

export type { SchemaId, SchemaVersion } from '@deepseek-ai/dsh-schema-registry/types'

/**
 * This build's runtime API version — the integer a boot passes as
 * {@link HostCompatContext.runtimeApiVersion}, and the one every manifest's
 * {@link RuntimeApiRange} is declared against. Monotonic, following this
 * repo's `SCHEMA_VERSION`/`SESSION_FORMAT_VERSION` convention: it rises only
 * when a change to the plugin-facing runtime makes a previously compatible
 * plugin incompatible.
 */
export const DSH_RUNTIME_API_VERSION: RuntimeApiVersion = brandNumber<RuntimeApiVersion>(1)

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
 * One manifest's declared {@link ProviderConstraint}, paired with the
 * manifest that declared it — {@link findProviderConstraintContradictions}'s
 * working unit for detecting a direct requires-provider/excludes-provider
 * clash on the same capability/provider pair across two different
 * manifests.
 */
interface ProviderConstraintSite {
  readonly manifest: PluginCompatManifest
  readonly constraint: ProviderConstraint
}

/**
 * Every {@link PluginId} whose `providedCapabilities` names a given
 * {@link CapabilityId}, across the whole graph — the single "who can
 * satisfy this capability" index both {@link findProviderConstraintContradictions}
 * and the per-manifest solve read from.
 */
function indexProvidedCapabilities(manifests: readonly PluginCompatManifest[]): Map<CapabilityId, PluginId[]> {
  const index = new Map<CapabilityId, PluginId[]>()
  for (const manifest of manifests) {
    for (const capabilityId of manifest.providedCapabilities) {
      const providers = index.get(capabilityId)
      if (providers) {
        providers.push(manifest.pluginId)
      } else {
        index.set(capabilityId, [manifest.pluginId])
      }
    }
  }
  return index
}

/**
 * must[2]'s direct contradiction: a required {@link CapabilityRequirement}
 * whose provider constraints include both a `'requires-provider'` naming
 * provider `P` (declared by one manifest) and an `'excludes-provider'`
 * naming the same `P` (declared by a different manifest), where `P` is the
 * graph's only provider of that capability. No provider assignment can
 * satisfy both declarations at once, and neither manifest's requirement is
 * more "at fault" than the other, so this is reported as a graph-level
 * {@link UnsatCore} rather than blocking one manifest and activating the
 * other — {@link solvePluginGraph} never silently picks a side. A
 * capability whose provider constraints do not fit this exact shape (no
 * opposing manifest, or a contested provider that is not the capability's
 * sole one) is left to the per-manifest solve in {@link solveManifest},
 * which blocks only the manifest whose own requirement fails.
 */
function findProviderConstraintContradictions(
  manifests: readonly PluginCompatManifest[],
  providedBy: ReadonlyMap<CapabilityId, readonly PluginId[]>,
): UnsatCore {
  const requiresSites = new Map<string, ProviderConstraintSite[]>()
  const excludesSites = new Map<string, ProviderConstraintSite[]>()

  for (const manifest of manifests) {
    for (const constraint of manifest.providerConstraints) {
      const requirement = manifest.capabilities.find(candidate => candidate.capabilityId === constraint.capabilityId)
      if (requirement?.necessity !== 'required') continue

      const key = `${constraint.capabilityId}\0${constraint.providerId}`
      const bucket = constraint.kind === 'requires-provider' ? requiresSites : excludesSites
      const site: ProviderConstraintSite = { manifest, constraint }
      const existing = bucket.get(key)
      if (existing) {
        existing.push(site)
      } else {
        bucket.set(key, [site])
      }
    }
  }

  const entries: UnsatCoreConstraint[] = []
  const seen = new Set<string>()

  for (const [key, requirers] of requiresSites) {
    const excluders = excludesSites.get(key)
    const anchor = requirers[0]
    if (!excluders || excluders.length === 0 || !anchor) continue

    const { capabilityId, providerId } = anchor.constraint
    const providers = providedBy.get(capabilityId) ?? []
    const isSoleProvider = providers.length === 1 && providers[0] === providerId
    if (!isSoleProvider) continue

    for (const site of [...requirers, ...excluders]) {
      const dedupeKey = `${site.manifest.pluginId}\0${site.constraint.capabilityId}\0${site.constraint.kind}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      entries.push({
        pluginId: site.manifest.pluginId,
        reasonCode: 'provider-constraint-violation',
        constraintRef: providerId,
        detail: site.constraint.kind === 'requires-provider'
          ? `requires-provider '${providerId}' for '${capabilityId}' directly contradicts another manifest's excludes-provider constraint on '${capabilityId}''s only provider`
          : `excludes-provider '${providerId}' for '${capabilityId}' rules out '${capabilityId}''s only provider, which another manifest's requires-provider constraint requires`,
      })
    }
  }

  return entries.sort((a, b) => comparePluginId(a.pluginId, b.pluginId))
}

/**
 * The {@link PluginId}s eligible to satisfy `manifest`'s own dependency on
 * `capabilityId`: the graph's providers of `capabilityId`, narrowed by
 * `manifest`'s own {@link ProviderConstraint}s for that capability — a
 * `'requires-provider'` constraint keeps only its named provider,
 * `'excludes-provider'` removes its named provider. Only `manifest`'s own
 * declared constraints narrow its own requirement; another manifest's
 * constraints on the same capability never do (see
 * {@link findProviderConstraintContradictions} for when that instead
 * signals a graph-level conflict).
 */
function admissibleProviders(
  manifest: PluginCompatManifest,
  capabilityId: CapabilityId,
  providedBy: ReadonlyMap<CapabilityId, readonly PluginId[]>,
): readonly PluginId[] {
  const base = providedBy.get(capabilityId) ?? []
  const own = manifest.providerConstraints.filter(constraint => constraint.capabilityId === capabilityId)
  if (own.length === 0) return base

  const requiredProviderIds = new Set(own.filter(constraint => constraint.kind === 'requires-provider').map(constraint => constraint.providerId))
  const excludedProviderIds = new Set(own.filter(constraint => constraint.kind === 'excludes-provider').map(constraint => constraint.providerId))

  return base.filter(providerId =>
    (requiredProviderIds.size === 0 || requiredProviderIds.has(providerId)) && !excludedProviderIds.has(providerId),
  )
}

/** must[0]'s runtime API range check: `host.runtimeApiVersion` must fall within `manifest.runtimeApiRange`'s inclusive bounds. */
function checkRuntimeApiRange(manifest: PluginCompatManifest, host: HostCompatContext): ConflictReasonCode | undefined {
  const { min, max } = manifest.runtimeApiRange
  return host.runtimeApiVersion >= min && host.runtimeApiVersion <= max ? undefined : 'runtime-api-range-incompatible'
}

/**
 * must[0]/acceptance[1]'s schema range check: every `manifest.schemaRanges`
 * entry's declared major band must cover the host's registered major for
 * that {@link SchemaId}. A `schemaId` the host has no registered version
 * for fails closed, the same as a registered major outside the declared
 * band — a manifest never resolves active against a schema the host
 * cannot confirm compatibility for.
 */
function checkSchemaRanges(manifest: PluginCompatManifest, host: HostCompatContext): ConflictReasonCode | undefined {
  for (const range of manifest.schemaRanges) {
    const registered = host.registeredSchemaVersions.get(range.schemaId)
    if (!registered || registered.major < range.minVersion.major || registered.major > range.maxVersion.major) {
      return 'schema-major-mismatch'
    }
  }
  return undefined
}

/**
 * One `manifest`'s {@link PluginActivation} once no graph-level
 * {@link UnsatCore} applies: blocked on the first of a runtime-API-range,
 * schema-range, or required-capability failure (checked in that priority
 * order — {@link ConflictReasonCode}'s only per-manifest codes), else
 * active with every unsatisfied optional capability listed in
 * `disabledOptionalCapabilities` (acceptance[2]).
 */
function solveManifest(
  manifest: PluginCompatManifest,
  host: HostCompatContext,
  providedBy: ReadonlyMap<CapabilityId, readonly PluginId[]>,
): PluginActivation {
  const runtimeReason = checkRuntimeApiRange(manifest, host)
  if (runtimeReason) {
    return { pluginId: manifest.pluginId, activation: { status: 'blocked', reasonCode: runtimeReason, missingCapabilities: [] } }
  }

  const schemaReason = checkSchemaRanges(manifest, host)
  if (schemaReason) {
    return { pluginId: manifest.pluginId, activation: { status: 'blocked', reasonCode: schemaReason, missingCapabilities: [] } }
  }

  const missingCapabilities: CapabilityId[] = []
  const disabledOptionalCapabilities: CapabilityId[] = []
  let blockedReasonCode: ConflictReasonCode | undefined

  for (const requirement of manifest.capabilities) {
    const admissible = admissibleProviders(manifest, requirement.capabilityId, providedBy)
    if (admissible.length > 0) continue

    if (requirement.necessity === 'optional') {
      disabledOptionalCapabilities.push(requirement.capabilityId)
      continue
    }

    missingCapabilities.push(requirement.capabilityId)
    if (!blockedReasonCode) {
      const globalProviders = providedBy.get(requirement.capabilityId) ?? []
      blockedReasonCode = globalProviders.length === 0 ? 'missing-required-capability' : 'provider-constraint-violation'
    }
  }

  if (blockedReasonCode) {
    return { pluginId: manifest.pluginId, activation: { status: 'blocked', reasonCode: blockedReasonCode, missingCapabilities } }
  }

  return { pluginId: manifest.pluginId, activation: { status: 'active', disabledOptionalCapabilities } }
}

/**
 * Stable, content-only ordering for two {@link PluginId}s — sorts
 * {@link LoadPlan.activations} and {@link UnsatCore} entries so the result
 * never depends on `manifests` array order (acceptance[0]).
 */
function comparePluginId(a: PluginId, b: PluginId): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Deterministic identity of a solved {@link LoadPlan}: a stable
 * serialization of every {@link PluginActivation} (with each activation's
 * own capability-id lists sorted), built from output already sorted by
 * {@link PluginId} — equal `manifests`/`host` inputs always produce an
 * equal `planId`, regardless of `manifests` array order (acceptance[0]).
 */
function computePlanId(activations: readonly PluginActivation[]): string {
  const canonical = activations.map((row) => {
    const activation = row.activation
    return {
      pluginId: row.pluginId,
      activation: activation.status === 'active'
        ? { status: 'active' as const, disabledOptionalCapabilities: [...activation.disabledOptionalCapabilities].sort() }
        : { status: 'blocked' as const, reasonCode: activation.reasonCode, missingCapabilities: [...activation.missingCapabilities].sort() },
    }
  })
  return JSON.stringify(canonical)
}

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
  const providedBy = indexProvidedCapabilities(manifests)

  const unsatCore = findProviderConstraintContradictions(manifests, providedBy)
  if (unsatCore.length > 0) {
    return { solvable: false, unsatCore }
  }

  const activations = manifests
    .map(manifest => solveManifest(manifest, host, providedBy))
    .sort((a, b) => comparePluginId(a.pluginId, b.pluginId))

  return { solvable: true, loadPlan: { activations, planId: computePlanId(activations) } }
}

/**
 * must[0]'s declaration read from a real plugin package's `package.json`
 * `dsh.compat` field: the on-disk projection of {@link PluginCompatManifest},
 * validated here rather than in the boot glue that reads the file, because a
 * `package.json` is an untrusted durable/file boundary and this package owns
 * what a well-formed declaration is.
 *
 * A package with no `dsh.compat` field declares no compatibility constraints
 * at all and is never blocked by this negotiation — `undefined` is returned
 * and the caller omits it from the graph. That is the only permissive case:
 * a `dsh.compat` that is present but malformed fails loud rather than
 * degrading to "unconstrained", so a typo in a security-critical capability
 * declaration can never silently admit the plugin (must[3]).
 * @param raw - the `dsh.compat` value read from the package's `package.json`,
 *   or `undefined` when the field is absent.
 * @param pluginId - the package's own name, used as the manifest's
 *   {@link PluginCompatManifest.pluginId}.
 * @returns the validated {@link PluginCompatManifest}, or `undefined` when
 *   `raw` is `undefined` (no declaration).
 * @throws Error when `raw` is present but is not a well-formed declaration.
 */
export function parseCompatDeclaration(raw: unknown, pluginId: PluginId): PluginCompatManifest | undefined {
  void raw
  void pluginId
  throw new Error('parseCompatDeclaration: not implemented')
}
