/**
 * Package entry point. Provider-stage: the real runtime module the
 * Contract-stage scaffold's own doc comment anticipated (this file carried
 * only `export type * from './types.ts'` through C-stage, per this
 * program's B4(f) scaffold rule). The main entry now re-exports every
 * Contract-stage runtime function (`./validate.ts`) alongside its types, so
 * `import { classifyPluginDeclaration } from '@deepseek-ai/dsh-plugin-manifest'`
 * works the same as the documented `/validate` subpath import — and adds
 * this package's first genuinely new Provider-stage logic:
 * {@link compareDeclaredToObserved} (acceptance[0]/[1]'s declared-vs-observed
 * comparison) and {@link decidePluginTrust} (acceptance[0]'s quarantine
 * decision for a manifest that passed schema validation).
 *
 * Both are pure functions over already-computed data, same as every
 * Contract-stage export: neither reads a plugin package's files nor
 * constructs a Cordis `Context`. Building the actual `ObservedPluginCapabilities`
 * value from a live boot — walking a real `Context`'s registrations — is a
 * later stage's job (typically `packages/host/plugin-inventory`, which
 * composes this package's types into its own `PluginPermissionState`); this
 * module only builds the comparison/decision logic that later stage calls
 * with real inputs.
 *
 * @module @deepseek-ai/dsh-plugin-manifest
 */
export type * from './types.ts'
export * from './validate.ts'

import { detectWildcardPermissions } from './validate.ts'
import type { WildcardFinding } from './validate.ts'
import type { PluginManifestV2 } from './types.ts'

/**
 * must[1]'s declaration vocabulary, mirrored for what a plugin actually
 * registered into a live Cordis `Context` — the counterpart
 * {@link PluginManifestV2}'s `services`/`tools`/`skills`/`mcp`/`events`
 * fields declare in advance. `ctxKeys` names every `ctx` key this plugin
 * actually provided (mirrors `ServiceCapabilityDeclaration.ctxKey` for
 * `role: 'provides'` entries only — a `'requires'` service consumes a key it
 * does not own, so it has no observed-registration counterpart); the
 * remaining fields mirror `ToolCapabilityDeclaration.name`,
 * `SkillCapabilityDeclaration.name`, `McpServerDeclaration.name`, and
 * `EventCapabilityDeclaration.name` respectively.
 *
 * This package never constructs one itself: reading a live `Context`'s
 * actual registrations needs Cordis and the Loader, which this pure-function
 * package does not depend on. A later stage builds one from real
 * introspection and passes it to {@link compareDeclaredToObserved}.
 */
export interface ObservedPluginCapabilities {
  readonly ctxKeys: readonly string[]
  readonly toolNames: readonly string[]
  readonly skillNames: readonly string[]
  readonly mcpServerNames: readonly string[]
  readonly eventNames: readonly string[]
}

/**
 * Which direction one {@link RegistrationMismatch} disagrees in.
 * `'undeclared-registration'` — the plugin actually registered a capability
 * its manifest never declared: acceptance[0]'s security-relevant case, since
 * the plugin did something it did not say it would. `'declared-not-registered'`
 * — the manifest declares a capability that never actually registered (for
 * example a conditional registration that did not fire this run).
 */
export type RegistrationMismatchKind = 'undeclared-registration' | 'declared-not-registered'

/** One capability name present on only one side of a declared-vs-observed comparison. */
export interface RegistrationMismatch {
  readonly kind: RegistrationMismatchKind
  readonly category: 'ctxKey' | 'tool' | 'skill' | 'mcpServer' | 'event'
  readonly name: string
}

/**
 * acceptance[0]'s "声明与实际注册不一致" (declaration/actual-registration
 * mismatch) findings, plus the manifest's own wildcard-permission findings
 * (must[0]'s Contract-stage {@link detectWildcardPermissions}), carried
 * alongside so a caller has every quarantine-worthy fact from one call.
 */
export interface PluginRegistrationComparison {
  readonly mismatches: readonly RegistrationMismatch[]
  readonly wildcardFindings: readonly WildcardFinding[]
}

/** Every declared capability name from `manifest`, grouped by {@link RegistrationMismatch.category}. */
function declaredCapabilityNames(manifest: PluginManifestV2): Record<RegistrationMismatch['category'], readonly string[]> {
  return {
    ctxKey: (manifest.services ?? []).filter(service => service.role === 'provides').map(service => service.ctxKey),
    tool: (manifest.tools ?? []).map(tool => tool.name),
    skill: (manifest.skills ?? []).map(skill => skill.name),
    mcpServer: (manifest.mcp?.servers ?? []).map(server => server.name),
    event: (manifest.events ?? []).map(event => event.name),
  }
}

/** Append every name present on only one side of `declared`/`observed` to `mismatches`. */
function diffCategory(
  category: RegistrationMismatch['category'],
  declared: readonly string[],
  observed: readonly string[],
  mismatches: RegistrationMismatch[],
): void {
  const declaredSet = new Set(declared)
  const observedSet = new Set(observed)
  for (const name of observedSet) {
    if (!declaredSet.has(name)) mismatches.push({ kind: 'undeclared-registration', category, name })
  }
  for (const name of declaredSet) {
    if (!observedSet.has(name)) mismatches.push({ kind: 'declared-not-registered', category, name })
  }
}

/**
 * Compare a validated manifest's declared capabilities against what a
 * plugin actually registered (acceptance[0]/[1]). Pure data comparison: the
 * caller supplies `observed` from a real Cordis `Context`, a live-boot
 * concern this package never performs itself (see
 * {@link ObservedPluginCapabilities}). Reuses Contract-stage's
 * {@link detectWildcardPermissions} rather than re-detecting overprivilege.
 * @param manifest - a manifest {@link validatePluginManifestV2} already accepted.
 * @param observed - the plugin's actual registrations from a live Context.
 * @returns every declared/observed mismatch and wildcard-destination finding.
 */
export function compareDeclaredToObserved(
  manifest: PluginManifestV2,
  observed: ObservedPluginCapabilities,
): PluginRegistrationComparison {
  const declared = declaredCapabilityNames(manifest)
  const mismatches: RegistrationMismatch[] = []
  diffCategory('ctxKey', declared.ctxKey, observed.ctxKeys, mismatches)
  diffCategory('tool', declared.tool, observed.toolNames, mismatches)
  diffCategory('skill', declared.skill, observed.skillNames, mismatches)
  diffCategory('mcpServer', declared.mcpServer, observed.mcpServerNames, mismatches)
  diffCategory('event', declared.event, observed.eventNames, mismatches)
  return { mismatches, wildcardFindings: detectWildcardPermissions(manifest) }
}

/**
 * acceptance[0]'s quarantine state for a plugin whose manifest already
 * passed schema validation: `'active'` — {@link compareDeclaredToObserved}
 * found no mismatch and no wildcard finding; `'quarantined'` — it found at
 * least one of either.
 *
 * This is a pure decision only: actually enforcing quarantine (blocking new
 * tool calls, isolating the plugin's `ctx` surface, surfacing it in an
 * installer UI) needs a real boot sequence and is a later stage's job, which
 * invokes this function rather than re-deciding the question. A `'missing'`
 * or `'legacy-untrusted'` `PluginDeclaration` never reaches this function —
 * Contract-stage's `isDeniedInProductionByDefault` already answers that
 * separate axis (must[3]'s production-default-deny rule), independent of
 * whether a valid manifest's declarations match its registrations.
 */
export type PluginTrustDecision = 'active' | 'quarantined'

/**
 * Decide a {@link PluginTrustDecision} from a {@link PluginRegistrationComparison}.
 * @param comparison - the result of {@link compareDeclaredToObserved}.
 * @returns `'quarantined'` when any mismatch or wildcard finding is present, `'active'` otherwise.
 */
export function decidePluginTrust(comparison: PluginRegistrationComparison): PluginTrustDecision {
  return comparison.mismatches.length > 0 || comparison.wildcardFindings.length > 0 ? 'quarantined' : 'active'
}
