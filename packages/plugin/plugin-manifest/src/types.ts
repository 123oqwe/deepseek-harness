/**
 * Contract-stage type surface for Plugin Manifest v2 (Epic P1-01): the static
 * declaration a plugin package carries under `package.json`'s `dsh` field so
 * an installer, a policy engine, or an administrator can know what a plugin
 * accesses, exposes, and modifies before it ever executes (must[0]).
 *
 * `package.json`'s `dsh` field already carries two sibling shapes in this
 * repo — `dsh.profile` (a profile's bundle list) and `dsh.bundle` (a bundle's
 * `cordis.patch.yml` pointer, see `docs/architecture.md#profiles-and-bundles`)
 * — neither of which declares any capability, permission, or side effect: a
 * bundle only names a patch file, and installing one today only confirms
 * `dsh.bundle` is present (see this package's own README for the exact
 * problem statement this epic answers). {@link PluginManifestV2} is a THIRD
 * `dsh` field shape, `dsh.manifestVersion === 2`, additive to (never
 * replacing) `dsh.bundle`/`dsh.profile` — a package may carry a manifest
 * alongside a bundle patch. {@link LegacyBundleDeclaration} models the old
 * `dsh.bundle`-only shape read for compatibility (must[3]); a package with
 * neither shape has no manifest at all — see this module's own
 * {@link PluginDeclaration} doc for how the three states relate.
 *
 * **Grounding.** Every field below reuses this repo's own existing
 * vocabulary rather than inventing a parallel one: {@link ExecutionMode}
 * mirrors `@deepseek-ai/dsh-code-runtime`'s `CodeRuntime.isolation` well-known
 * values (`'worker-thread'`, `'process'`, `'container'`) plus
 * `dsh-subagent-fork-in-process`/`dsh-subagent-spawn-in-process`'s
 * `'in-process'` distinction; {@link EventCapabilityDeclaration.mode} is
 * `@deepseek-ai/cordis`'s own `DispatchMode`, not a redeclared copy;
 * {@link McpServerDeclaration.transport} mirrors `@deepseek-ai/dsh-mcp-client`'s
 * real `'stdio' | 'streamable-http'` `Config` union; {@link McpServerDeclaration.name}
 * mirrors that same package's `serverName` grammar
 * (`/^[A-Za-z0-9_-]{1,32}$/`); {@link SkillCapabilityDeclaration.name} mirrors
 * `@deepseek-ai/dsh-skill`'s kebab-case `SKILL_NAME` grammar
 * (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`). `sideEffectClass`, `authAudience`,
 * `allowedDestinations`, and `dataClassification` (must[1]) have no existing
 * precedent in this repo — this module's own doc comments on
 * {@link SideEffectClass}, {@link AuthAudience}, {@link CapabilityDestination},
 * and {@link DataClassification} record the interpretation this slice commits
 * to, for a later stage or reviewer to hold accountable.
 *
 * **Static data, not generated code (must[2]).** Every exported type below
 * describes a plain JSON-serializable value: `PluginManifestV2` has no
 * function-typed field, no method, and no class instance anywhere in its
 * shape, and this module's only import is a type-only `DispatchMode` from
 * `@deepseek-ai/cordis` (a literal-string union, itself JSON-serializable).
 * A manifest is therefore always representable as literal JSON embedded in
 * `package.json`, and reading one (see
 * `validate.ts`) never needs to import, `require`, or otherwise execute the
 * plugin package's own code — the property this repo's own `dsh.bundle`
 * precedent already has as a `cordis.patch.yml` file, extended here to a
 * capability declaration. `validate.ts`'s `assertJsonSerializable` gives this
 * a genuine runtime check: a value carrying a function, a `symbol`, or
 * `undefined` inside an array could only have been built by running code, so
 * it is rejected as not static data — the one concretely checkable
 * consequence of must[2] a pure function can prove, forbidding what code
 * execution would necessarily leave behind rather than trying to detect code
 * execution itself.
 *
 * @module @deepseek-ai/dsh-plugin-manifest/types
 */

import type { DispatchMode } from '@deepseek-ai/cordis'

/**
 * Severity tag for what a capability's own invocation may do, independent of
 * what it is permitted to reach ({@link CapabilityDestination} covers reach).
 * Declared per Tool/MCP capability (must[1]). Ordered least to most
 * consequential; a capability with several effects declares the highest one
 * that applies — `validate.ts` does not further decompose a composite effect,
 * that granularity is a P/U-stage runtime-policy concern, not this
 * Contract-stage schema's job.
 */
export type SideEffectClass = 'none' | 'read' | 'write' | 'network' | 'process' | 'destructive'

/**
 * Who may invoke a capability without further per-call human confirmation
 * (must[1]'s "auth audience"). This repo has no prior "audience" vocabulary
 * for tool/MCP invocation to extend, so this slice fixes one: `'model'` — the
 * DeepSeek model may call it autonomously as ordinary tool-calling, subject
 * to whatever sandbox/approval policy otherwise applies; `'user'` — every
 * call must originate from, or be explicitly confirmed by, a human, never
 * from unattended model tool-calling; `'service'` — restricted to
 * harness-internal, plugin-to-plugin calls, never exposed to the model or a
 * human directly. A capability may declare more than one audience.
 */
export type AuthAudience = 'model' | 'user' | 'service'

/**
 * Sensitivity tier of data a capability may read, produce, or transmit
 * (must[1]). No prior classification vocabulary exists in this repo to
 * extend; this slice fixes a standard four-tier scale, least to most
 * sensitive.
 */
export type DataClassification = 'public' | 'internal' | 'confidential' | 'secret'

/**
 * One destination a capability's declared side effects are permitted to
 * reach (must[1]'s "allowed destinations"). A discriminated union so a
 * filesystem path pattern, a network host pattern, and a process command
 * pattern each keep their own real shape instead of collapsing into one
 * untyped string. `'*'`, `'**'`, and `'/'` are the maximally broad patterns
 * for their kind — `validate.ts`'s wildcard detector (acceptance[0]'s
 * "申请通配权限" / requesting wildcard permission) flags any of them.
 */
export type CapabilityDestination =
  | { readonly kind: 'filesystem'; readonly pathPattern: string }
  | { readonly kind: 'network'; readonly hostPattern: string }
  | { readonly kind: 'process'; readonly commandPattern: string }

/**
 * The must[1] fields every Tool/MCP capability declares: side-effect class,
 * auth audience, allowed destinations, and data classification. `authAudience`
 * and `allowedDestinations` are typed non-empty (mirroring
 * `@deepseek-ai/dsh-credentials`' `AuthorizationFlow.methods` non-empty-tuple
 * idiom): a capability with side effects always has at least one audience and
 * at least one reachable destination, even if that destination is a single
 * narrow pattern; a capability with neither declares `sideEffectClass: 'none'`
 * and an empty `allowedDestinations` instead of an artificial placeholder
 * entry.
 */
export interface CapabilityEffectDeclaration {
  readonly sideEffectClass: SideEffectClass
  readonly authAudience: readonly [AuthAudience, ...AuthAudience[]]
  readonly allowedDestinations: readonly CapabilityDestination[]
  readonly dataClassification: DataClassification
}

/**
 * A Cordis Service Definition/Provider/Consumer this plugin package
 * contributes to `ctx`, by `ctx` key — the same key a real plugin's
 * `export const inject = [...]` names, or a `declare module '@deepseek-ai/cordis'`
 * augmentation provides. `'requires'` mirrors `inject`; `'provides'` mirrors
 * a service the plugin registers or augments `Context` with.
 */
export interface ServiceCapabilityDeclaration {
  /** The `ctx` key, e.g. `'skills'`, `'llm'`, `'tools'`. */
  readonly ctxKey: string
  readonly role: 'provides' | 'requires'
}

/** must[1]'s per-Tool capability declaration: one model-facing or user-facing tool this plugin registers. */
export interface ToolCapabilityDeclaration extends CapabilityEffectDeclaration {
  /** Model-facing tool name, e.g. the `ToolDefinition.name` a real registration uses. */
  readonly name: string
  readonly description?: string
}

/** Transport a remote capability provider connects over — `@deepseek-ai/dsh-mcp-client`'s real `Config['transport']` union. */
export type CapabilityTransport = 'stdio' | 'streamable-http'

/**
 * How a remote capability provider proves identity to (or accepts identity
 * from) the destination it connects to. `'none'` — no credential, e.g. a
 * local stdio child process; `'header-credential'` — a bearer/API-key value
 * attached as a request header (`StreamableHttpConfig.headers`'s real use
 * today); `'oauth'`; `'mtls'`.
 */
export type AuthMechanism = 'none' | 'header-credential' | 'oauth' | 'mtls'

/**
 * Fields acceptance[3] requires before a Skill or MCP Provider may enter a
 * production profile: transport, auth mechanism/audience, network
 * destination, and side effects. Shared by {@link McpServerDeclaration} and a
 * remotely-sourced {@link SkillCapabilityDeclaration.remoteProvider} — the
 * same four facts, whichever protocol carries them. Unlike
 * {@link CapabilityEffectDeclaration}'s possibly-empty `allowedDestinations`
 * (a pure-computation Tool may reach nothing), a remote provider always
 * connects somewhere — `allowedDestinations` is non-empty here, so
 * "undeclared network destination" (acceptance[3]) is a genuine schema
 * violation, not merely an empty array.
 */
export interface RemoteProviderDeclaration extends Omit<CapabilityEffectDeclaration, 'allowedDestinations'> {
  readonly transport: CapabilityTransport
  readonly authMechanism: AuthMechanism
  readonly allowedDestinations: readonly [CapabilityDestination, ...CapabilityDestination[]]
}

/** One resource an MCP server exposes, and the sensitivity of what it may return. */
export interface McpResourceDeclaration {
  /** URI pattern the resource is addressed by. */
  readonly uriPattern: string
  readonly dataClassification: DataClassification
}

/** One prompt template an MCP server exposes. */
export interface McpPromptDeclaration {
  readonly name: string
  readonly description?: string
}

/**
 * One MCP server this plugin connects to. `name` mirrors
 * `@deepseek-ai/dsh-mcp-client`'s real `serverName` grammar
 * (`/^[A-Za-z0-9_-]{1,32}$/`, the stable local namespace behind
 * `mcp__<serverName>__<rawName>` model-facing tool names).
 */
export interface McpServerDeclaration extends RemoteProviderDeclaration {
  readonly name: string
  readonly resources?: readonly McpResourceDeclaration[]
  readonly prompts?: readonly McpPromptDeclaration[]
}

/** must[0]'s "MCP servers/resources/prompts": every MCP server this plugin connects to. */
export interface McpCapabilityDeclaration {
  readonly servers: readonly McpServerDeclaration[]
}

/**
 * One skill this plugin contributes. `name` mirrors
 * `@deepseek-ai/dsh-skill`'s real kebab-case `SKILL_NAME` grammar
 * (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, `isSkillName`).
 */
export interface SkillCapabilityDeclaration {
  readonly name: string
  readonly sideEffectClass: SideEffectClass
  readonly dataClassification: DataClassification
  /**
   * Present when this skill is sourced from a remote/external Skill Provider
   * (acceptance[3]'s "Skill … Provider"); absent for a skill body bundled
   * directly in this plugin package, which has no transport of its own.
   */
  readonly remoteProvider?: RemoteProviderDeclaration
}

/**
 * One Cordis event this plugin emits or intercepts, by name. `mode` is
 * `@deepseek-ai/cordis`'s own {@link DispatchMode} — this repo's real, already
 * event-JSDoc-mandated `@mode` vocabulary (`'emit' | 'parallel' | 'serial' |
 * 'bail' | 'waterfall'`), reused rather than redeclared.
 */
export interface EventCapabilityDeclaration {
  readonly name: string
  readonly mode: DispatchMode
}

/** must[0]'s "filesystem": path patterns this plugin reads from or writes to, independent of any one tool's own declaration. */
export interface FilesystemCapabilityDeclaration {
  readonly readPaths: readonly string[]
  readonly writePaths: readonly string[]
}

/** must[0]'s "network": host patterns this plugin may reach outside any one tool/MCP declaration. */
export interface NetworkCapabilityDeclaration {
  readonly hostPatterns: readonly string[]
}

/** must[0]'s "process": command patterns this plugin may spawn outside any one tool declaration. */
export interface ProcessCapabilityDeclaration {
  readonly commandPatterns: readonly string[]
}

/**
 * must[0]'s "secrets": one credential this plugin requests access to.
 * `key` follows `@deepseek-ai/dsh-credentials`' `<scope>/<id>` `CredentialKey`
 * convention as a plain string — this package does not depend on
 * `@deepseek-ai/dsh-credentials` itself, so it names the convention without
 * importing its (much heavier) runtime service.
 */
export interface SecretCapabilityDeclaration {
  readonly key: string
  /** Human-readable justification for why this plugin needs `key`, shown to an installer or administrator. */
  readonly reason: string
}

/** must[0]'s "UI surfaces": one host-rendered surface (a `ui-*` panel, a settings page) this plugin contributes to. */
export interface UiSurfaceCapabilityDeclaration {
  readonly surfaceId: string
  readonly description?: string
}

/** must[0]'s "data stores": one named storage domain this plugin owns, in `@deepseek-ai/dsh-storage-domain`'s "domain" vocabulary. */
export interface DataStoreCapabilityDeclaration {
  readonly domainName: string
  readonly dataClassification: DataClassification
}

/**
 * must[0]'s "migrations": one schema migration step this plugin's data
 * stores require, mirroring the repo-wide monotonic `SCHEMA_VERSION`
 * convention.
 */
export interface MigrationDeclaration {
  readonly fromVersion: number
  readonly toVersion: number
  readonly description: string
}

/**
 * How this plugin's own code executes, as a closed set (unlike
 * `CodeRuntime.isolation`'s open `string` — a manifest is data with a fixed
 * vocabulary, not a class hierarchy). Values mirror this repo's real
 * execution substrates: `'in-process'` (`dsh-subagent-fork-in-process`'s
 * naming), `'worker-thread'` (`dsh-workflow-worker-thread`,
 * `CodeRuntime.isolation`'s `'worker-thread'`), `'process'`
 * (`CodeRuntime.isolation`'s `'process'`, a spawned subprocess), `'container'`
 * (`CodeRuntime.isolation`'s `'container'`, e.g. `dsh-e2b`).
 */
export type ExecutionMode = 'in-process' | 'worker-thread' | 'process' | 'container'

/**
 * must[0]'s "compatibility": the harness version range this manifest is
 * valid for, in the same semver-range string convention every package's own
 * `package.json` `engines.node` field already uses in this repo.
 */
export interface CompatibilityDeclaration {
  readonly dshVersionRange: string
}

/**
 * The complete Plugin Manifest v2 value (must[0]): the `dsh` field of a
 * plugin package's `package.json` when that package opts into capability
 * declaration, discriminated by `manifestVersion === 2`. `executionMode` and
 * `compatibility` are always present — every plugin has exactly one of each
 * — while every other field is an optional array/object a plugin includes
 * only for the capabilities it actually has; an absent field means "declares
 * none of this kind," never "unknown."
 */
export interface PluginManifestV2 {
  readonly manifestVersion: 2
  readonly services?: readonly ServiceCapabilityDeclaration[]
  readonly tools?: readonly ToolCapabilityDeclaration[]
  readonly skills?: readonly SkillCapabilityDeclaration[]
  readonly mcp?: McpCapabilityDeclaration
  readonly events?: readonly EventCapabilityDeclaration[]
  readonly filesystem?: FilesystemCapabilityDeclaration
  readonly network?: NetworkCapabilityDeclaration
  readonly process?: ProcessCapabilityDeclaration
  readonly secrets?: readonly SecretCapabilityDeclaration[]
  readonly uiSurfaces?: readonly UiSurfaceCapabilityDeclaration[]
  readonly dataStores?: readonly DataStoreCapabilityDeclaration[]
  readonly migrations?: readonly MigrationDeclaration[]
  readonly executionMode: ExecutionMode
  readonly compatibility: CompatibilityDeclaration
}

/**
 * must[3]'s legacy compatibility read: the old `dsh.bundle`-only shape
 * (`package.json`'s real `{ dsh: { bundle: { patch: "./cordis.patch.yml" } } }`,
 * see `docs/architecture.md#profiles-and-bundles`), which declares no
 * capability at all — only a patch-file pointer. `trust` is always
 * `'legacy-untrusted'`: there is no declared permission surface to trust, by
 * construction, so every legacy-format package reads as maximally
 * conservative rather than as implicitly benign.
 */
export interface LegacyBundleDeclaration {
  readonly trust: 'legacy-untrusted'
  /** The bundle's `dsh.bundle.patch` value, verbatim. */
  readonly patch: string
}

/**
 * The three states a plugin package's `dsh` field can classify to
 * (acceptance[0]): a valid v2 manifest, a legacy bundle read for
 * compatibility only (must[3]), or neither present — `'missing'`, which
 * acceptance[0] requires to fail installation or enter explicit quarantine
 * (a P/U-stage runtime decision; this Contract-stage type only names the
 * state `validate.ts`'s classifier can detect).
 */
export type PluginDeclaration =
  | { readonly kind: 'manifest-v2'; readonly manifest: PluginManifestV2 }
  | { readonly kind: 'legacy-untrusted'; readonly legacy: LegacyBundleDeclaration }
  | { readonly kind: 'missing' }
