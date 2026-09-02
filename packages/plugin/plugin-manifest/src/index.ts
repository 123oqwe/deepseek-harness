/**
 * Package entry point. Provider-stage added declared-vs-observed comparison
 * ({@link compareDeclaredToObserved}, {@link decidePluginTrust}) as pure
 * functions over already-computed data. Usage-stage (Epic P1-01.U) adds this
 * module's first real POLICY function, {@link evaluatePreMountAdmission},
 * which `packages/boot/app-boot/src/profile.ts` and `apps/cli/src/plugin.ts`
 * call at real profile-boot/verify time (acceptance[0], must[3]) — this
 * module still never reads a plugin package's files, spawns a Loader, or
 * constructs a Cordis `Context` itself; {@link ObservedPluginCapabilities} is
 * still built by `packages/host/plugin-inventory` from a live `Context`, and
 * the boot-time call sites (not this module) decide what happens to a denied
 * or quarantined plugin (exclude it from composition, dispose its fiber, or
 * fail the whole boot).
 *
 * **BLOCKED-027 re-judgment (required Usage-stage Reviewer checklist item).**
 * The Provider-stage Known Limitation this ticket names — `compareDeclaredToObserved`
 * matches by capability identity (name) only, never by field content
 * (`sideEffectClass`/`authAudience`/`allowedDestinations`/`dataClassification`),
 * and never descends into `McpServerDeclaration.resources`/`prompts` — is
 * RATIFIED, not silently carried forward: this Usage-stage's real
 * `ObservedPluginCapabilities` builder
 * (`packages/host/plugin-inventory/src/index.ts`'s `buildObservedPluginCapabilities`)
 * reads live Cordis registrations through `Fiber.getEffects()` labels and the
 * global `ReflectService` store — neither surface carries `sideEffectClass`,
 * `authAudience`, `allowedDestinations`, or `dataClassification` anywhere, for
 * any registration kind, in this codebase today. A `ToolDefinition`
 * (`packages/core/tools/src/index.ts`), a Cordis service `Impl`
 * (`vendor/cordis/src/reflect.ts`), an MCP server's Loader `Fiber.config`
 * (`packages/mcp/mcp-client`), and a registered skill's `SkillDefinition`
 * (`packages/skill/skill/src/index.ts`) each carry zero fields matching this
 * manifest's must[1] effect vocabulary — that vocabulary is this epic's own
 * invention (`./types.ts`'s own doc comment: "no existing precedent in this
 * repo"), not yet threaded through any real registration call site anywhere
 * in the harness. A field-content comparison here would therefore compare a
 * declared value against a field that structurally cannot exist on the
 * observed side — not a weaker check, but a vacuous one (`undefined ===
 * undefined` on every capability, every time), which is worse than no check:
 * it would read as a real guarantee in this module's own types while
 * verifying nothing. The real gap this leaves is not closeable inside
 * `@deepseek-ai/dsh-plugin-manifest`, `dsh-plugin-inventory`, or
 * `dsh-app-boot` — it needs a separate, larger change threading effect
 * metadata through every tool/skill/MCP/event registration call site
 * repo-wide so a live registration can carry its own declared effect fields
 * for comparison, which is out of this slice's declared file set and a
 * different epic-sized undertaking. Identity-only comparison is therefore the
 * real Usage-stage enforcement design, not a placeholder for one — see
 * `evaluatePreMountAdmission`'s and `compareDeclaredToObserved`'s own doc
 * comments for exactly what each does and does not check.
 *
 * @module @deepseek-ai/dsh-plugin-manifest
 */
export type * from './types.ts'
export * from './validate.ts'

import { detectWildcardPermissions, isDeniedInProductionByDefault } from './validate.ts'
import type { WildcardFinding } from './validate.ts'
import type { PluginDeclaration, PluginManifestV2 } from './types.ts'

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

/**
 * Why {@link evaluatePreMountAdmission} refused a plugin, before any of its
 * code has run. `'missing-manifest'`/`'legacy-untrusted'` mirror
 * {@link isDeniedInProductionByDefault}'s two denied `PluginDeclaration.kind`
 * values (must[3]); `'wildcard-permission'` is acceptance[0]'s "申请通配权限"
 * on an otherwise schema-valid manifest.
 */
export type PreMountDenialReason = 'missing-manifest' | 'legacy-untrusted' | 'wildcard-permission'

/**
 * acceptance[0]/must[3]'s pre-mount admission decision for one plugin, before
 * any of its code has run: whether a production profile boot may compose
 * this declaration's plugin into the tree at all. Pure and static — checked
 * entirely from `declaration` itself, the same value {@link classifyPluginDeclaration}
 * returns from a package's `package.json` `dsh` field — never a live
 * `Context`. `packages/boot/app-boot/src/profile.ts`'s real profile
 * composition calls this per bundle layer before `boot()` mounts anything
 * (must[3]'s "生产 profile 默认拒绝" / production profile denies by default);
 * `apps/cli/src/plugin.ts`'s `pnpm plugin:verify <fixture>` calls it directly
 * against one fixture file for the same decision with no profile involved.
 * @param declaration - a value {@link classifyPluginDeclaration} returned.
 * @param production - whether the target profile enforces production
 * admission (`packages/boot/app-boot/src/profile.ts`'s `resolvePluginEnforcementMode`);
 * `false` admits every declaration unconditionally — every profile boots
 * exactly as it did before this policy existed.
 * @returns `{ admitted: true }`, or `{ admitted: false, reason, wildcardFindings }`
 * naming why a production boot refuses this plugin.
 */
export function evaluatePreMountAdmission(
  declaration: PluginDeclaration,
  production: boolean,
): { readonly admitted: true } | {
  readonly admitted: false
  readonly reason: PreMountDenialReason
  readonly wildcardFindings: readonly WildcardFinding[]
} {
  if (!production) return { admitted: true }
  if (isDeniedInProductionByDefault(declaration)) {
    return {
      admitted: false,
      reason: declaration.kind === 'missing' ? 'missing-manifest' : 'legacy-untrusted',
      wildcardFindings: [],
    }
  }
  // isDeniedInProductionByDefault(declaration) === false narrows declaration.kind to 'manifest-v2'.
  const manifestDeclaration = declaration as Extract<PluginDeclaration, { kind: 'manifest-v2' }>
  const wildcardFindings = detectWildcardPermissions(manifestDeclaration.manifest)
  if (wildcardFindings.length > 0) return { admitted: false, reason: 'wildcard-permission', wildcardFindings }
  return { admitted: true }
}
