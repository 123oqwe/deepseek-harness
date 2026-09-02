/**
 * Contract-stage pure validation logic for Plugin Manifest v2 (Epic P1-01).
 * Every export here is a pure function over already-parsed JSON-shaped
 * `unknown` input — none reads a file, spawns a process, or imports the
 * plugin package it validates, so calling this module can never itself
 * become the "executing package code" must[2] forbids. A later P/U-stage
 * `pnpm plugin:verify <fixture>` CLI (validation[]) is the intended real
 * caller of {@link classifyPluginDeclaration}; this slice only builds the
 * logic that CLI dispatches to.
 *
 * @module @deepseek-ai/dsh-plugin-manifest/validate
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {
  AuthAudience,
  CapabilityDestination,
  CapabilityEffectDeclaration,
  DataClassification,
  LegacyBundleDeclaration,
  PluginDeclaration,
  PluginManifestV2,
  SideEffectClass,
} from './types.ts'

/** One schema-validation failure: a JSON Pointer-style path plus what is wrong there. */
export interface ManifestValidationError {
  /** Dotted/bracketed path from the manifest root, e.g. `tools[0].sideEffectClass`. */
  readonly path: string
  readonly message: string
}

/** Result of validating an `unknown` value against the {@link PluginManifestV2} schema. */
export type ManifestValidationResult =
  | { readonly valid: true; readonly manifest: PluginManifestV2 }
  | { readonly valid: false; readonly errors: readonly ManifestValidationError[] }

/** One overprivileged finding: a destination pattern that grants unrestricted access (acceptance[0]'s "通配权限" / wildcard permission). */
export interface WildcardFinding {
  /** Path to the offending field, matching {@link ManifestValidationError.path}'s convention. */
  readonly path: string
  readonly pattern: string
}

const SIDE_EFFECT_CLASSES: readonly SideEffectClass[] = ['none', 'read', 'write', 'network', 'process', 'destructive']
const AUTH_AUDIENCES: readonly AuthAudience[] = ['model', 'user', 'service']
const DATA_CLASSIFICATIONS: readonly DataClassification[] = ['public', 'internal', 'confidential', 'secret']
const TRANSPORTS = ['stdio', 'streamable-http']
const AUTH_MECHANISMS = ['none', 'header-credential', 'oauth', 'mtls']
const DISPATCH_MODES = ['emit', 'parallel', 'serial', 'bail', 'waterfall']
const EXECUTION_MODES = ['in-process', 'worker-thread', 'process', 'container']

/** `@deepseek-ai/dsh-mcp-client`'s real `serverName` grammar. */
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
/** `@deepseek-ai/dsh-skill`'s real `SKILL_NAME` grammar. */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Patterns treated as maximally broad for their {@link CapabilityDestination} kind — an unrestricted grant. */
const WILDCARD_PATTERNS: ReadonlySet<string> = new Set(['*', '**', '/'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pushError(errors: ManifestValidationError[], path: string, message: string): void {
  errors.push({ path, message })
}

/** One pending {@link assertJsonSerializable} check: a value plus the path it was found at. */
interface JsonSerializableFrame {
  readonly value: unknown
  readonly path: string
  /**
   * `true` only for a value taken directly from an array. An `undefined`
   * array element is itself the error (JSON.parse can never produce one); an
   * `undefined` object-property value is a legal absent-optional-field and
   * is never flagged, so this distinguishes the two cases at pop time.
   */
  readonly arrayElement?: boolean
}

/**
 * Reject any value a plugin author could not have written as literal JSON —
 * a function, a `symbol`, or `undefined` nested inside an array — the one
 * concretely checkable consequence of must[2]'s "must be static data,
 * forbidding generation by executing package code": none of these three
 * kinds can survive `JSON.parse`, so their presence proves the value was
 * built by running code, not by parsing a file. A top-level `undefined`
 * object property is legal (an optional field simply absent) and is not
 * flagged; `exactOptionalPropertyTypes` already keeps this module's own
 * types from assigning `undefined` to an optional field on purpose.
 *
 * Walks `value`'s full tree with an explicit work stack, not recursion: this
 * function runs against a manifest field an attacker fully controls before
 * any other structural check rejects it, and a manifest whose JSON is merely
 * deep (not large) previously overflowed Node's call stack — an uncaught
 * `RangeError` that crashed the caller (`dsh plugin verify`, or a whole
 * profile boot mid-admission) instead of a clean validation failure. An
 * explicit stack has no comparable engine-level depth limit.
 * @param value - the candidate value, at any depth of a manifest.
 * @param path - the field path `value` was found at, for error reporting.
 * @param errors - mutable accumulator this function appends to.
 */
function assertJsonSerializable(value: unknown, path: string, errors: ManifestValidationError[]): void {
  const stack: JsonSerializableFrame[] = [{ value, path }]
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    if (frame.arrayElement === true && frame.value === undefined) {
      pushError(errors, frame.path, 'array elements must not be undefined — JSON.parse can never produce this')
      continue
    }
    if (typeof frame.value === 'function') {
      pushError(errors, frame.path, 'must be static JSON data, not a function — manifests are never generated by executing package code')
      continue
    }
    if (typeof frame.value === 'symbol') {
      pushError(errors, frame.path, 'must be static JSON data, not a symbol')
      continue
    }
    if (Array.isArray(frame.value)) {
      // Every element -- including an `undefined` one -- is deferred onto
      // the stack as `arrayElement: true` rather than checked here, so
      // popping order reproduces the original recursive implementation's
      // true left-to-right index order even when an `undefined` element
      // sits before a later element with a deeply nested violation.
      const children: JsonSerializableFrame[] = frame.value.map((item, index) => ({
        value: item,
        path: `${frame.path}[${index}]`,
        arrayElement: true,
      }))
      // A spread call (`stack.push(...children.reverse())`) hits V8's
      // ~125,000-argument spread-call limit on a wide array, throwing the
      // exact `RangeError` this function exists to prevent. `.reverse()`
      // itself has no such limit (an in-place index swap, not a variadic
      // call); only the push-by-spread did, so pushing one element per
      // call keeps the identical reversed order without it.
      for (const child of children.reverse()) stack.push(child)
      continue
    }
    if (isRecord(frame.value)) {
      const children = Object.entries(frame.value).map(([key, propertyValue]) => ({
        value: propertyValue,
        path: frame.path === '' ? key : `${frame.path}.${key}`,
      }))
      for (const child of children.reverse()) stack.push(child)
    }
  }
}

function validateStringArray(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!Array.isArray(value)) {
    pushError(errors, path, 'must be an array of strings')
    return
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') pushError(errors, `${path}[${index}]`, 'must be a string')
  })
}

function validateEnum(value: unknown, path: string, allowed: readonly string[], errors: ManifestValidationError[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    pushError(errors, path, `must be one of ${allowed.map(v => `"${v}"`).join(', ')}`)
  }
}

function validateDestination(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) {
    pushError(errors, path, 'must be an object with a "kind" discriminant')
    return
  }
  switch (value.kind) {
    case 'filesystem':
      if (typeof value.pathPattern !== 'string') pushError(errors, `${path}.pathPattern`, 'must be a string')
      break
    case 'network':
      if (typeof value.hostPattern !== 'string') pushError(errors, `${path}.hostPattern`, 'must be a string')
      break
    case 'process':
      if (typeof value.commandPattern !== 'string') pushError(errors, `${path}.commandPattern`, 'must be a string')
      break
    default:
      pushError(errors, `${path}.kind`, 'must be one of "filesystem", "network", "process"')
  }
}

/**
 * must[1]'s four required fields, shared by every Tool/MCP-shaped capability.
 * @param requireNonEmptyDestinations - `true` for a remote provider (an MCP
 *   server or a remote-sourced Skill; `./types.ts`'s `RemoteProviderDeclaration`)
 *   (acceptance[3]: a remote provider always connects somewhere, so an empty
 *   `allowedDestinations` is itself "undeclared network destination"); `false`
 *   for a plain Tool, which may legitimately reach nothing.
 */
function validateEffectFields(
  value: Record<string, unknown>,
  path: string,
  errors: ManifestValidationError[],
  requireNonEmptyDestinations: boolean,
): void {
  validateEnum(value.sideEffectClass, `${path}.sideEffectClass`, SIDE_EFFECT_CLASSES, errors)
  if (!Array.isArray(value.authAudience) || value.authAudience.length === 0) {
    pushError(errors, `${path}.authAudience`, 'must be a non-empty array')
  } else {
    value.authAudience.forEach((item, index) => { validateEnum(item, `${path}.authAudience[${index}]`, AUTH_AUDIENCES, errors) })
  }
  if (!Array.isArray(value.allowedDestinations)) {
    pushError(errors, `${path}.allowedDestinations`, 'must be an array')
  } else {
    if (requireNonEmptyDestinations && value.allowedDestinations.length === 0) {
      pushError(
        errors,
        `${path}.allowedDestinations`,
        'must declare at least one destination — a remote provider always connects somewhere',
      )
    }
    value.allowedDestinations.forEach((item, index) => { validateDestination(item, `${path}.allowedDestinations[${index}]`, errors) })
  }
  validateEnum(value.dataClassification, `${path}.dataClassification`, DATA_CLASSIFICATIONS, errors)
}

function validateService(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.ctxKey !== 'string') pushError(errors, `${path}.ctxKey`, 'must be a string')
  validateEnum(value.role, `${path}.role`, ['provides', 'requires'], errors)
}

function validateTool(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.name !== 'string') pushError(errors, `${path}.name`, 'must be a string')
  if (value.description !== undefined && typeof value.description !== 'string') {
    pushError(errors, `${path}.description`, 'must be a string when present')
  }
  validateEffectFields(value, path, errors, false)
}

function validateRemoteProvider(value: Record<string, unknown>, path: string, errors: ManifestValidationError[]): void {
  validateEnum(value.transport, `${path}.transport`, TRANSPORTS, errors)
  validateEnum(value.authMechanism, `${path}.authMechanism`, AUTH_MECHANISMS, errors)
  validateEffectFields(value, path, errors, true)
}

function validateMcpServer(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.name !== 'string' || !MCP_SERVER_NAME_PATTERN.test(value.name)) {
    pushError(errors, `${path}.name`, 'must match /^[A-Za-z0-9_-]{1,32}$/')
  }
  validateRemoteProvider(value, path, errors)
  if (value.resources !== undefined) {
    if (!Array.isArray(value.resources)) {
      pushError(errors, `${path}.resources`, 'must be an array when present')
    } else {
      value.resources.forEach((resource, index) => {
        const resourcePath = `${path}.resources[${index}]`
        if (!isRecord(resource)) { pushError(errors, resourcePath, 'must be an object'); return }
        if (typeof resource.uriPattern !== 'string') pushError(errors, `${resourcePath}.uriPattern`, 'must be a string')
        validateEnum(resource.dataClassification, `${resourcePath}.dataClassification`, DATA_CLASSIFICATIONS, errors)
      })
    }
  }
  if (value.prompts !== undefined) {
    if (!Array.isArray(value.prompts)) {
      pushError(errors, `${path}.prompts`, 'must be an array when present')
    } else {
      value.prompts.forEach((prompt, index) => {
        const promptPath = `${path}.prompts[${index}]`
        if (!isRecord(prompt) || typeof prompt.name !== 'string') pushError(errors, `${promptPath}.name`, 'must be a string')
      })
    }
  }
}

function validateSkill(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.name !== 'string' || !SKILL_NAME_PATTERN.test(value.name)) {
    pushError(errors, `${path}.name`, 'must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/')
  }
  validateEnum(value.sideEffectClass, `${path}.sideEffectClass`, SIDE_EFFECT_CLASSES, errors)
  validateEnum(value.dataClassification, `${path}.dataClassification`, DATA_CLASSIFICATIONS, errors)
  if (value.remoteProvider !== undefined) {
    if (!isRecord(value.remoteProvider)) {
      pushError(errors, `${path}.remoteProvider`, 'must be an object when present')
    } else {
      validateRemoteProvider(value.remoteProvider, `${path}.remoteProvider`, errors)
    }
  }
}

function validateEvent(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.name !== 'string') pushError(errors, `${path}.name`, 'must be a string')
  validateEnum(value.mode, `${path}.mode`, DISPATCH_MODES, errors)
}

function validateSecret(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.key !== 'string') pushError(errors, `${path}.key`, 'must be a string')
  if (typeof value.reason !== 'string') pushError(errors, `${path}.reason`, 'must be a string')
}

function validateUiSurface(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.surfaceId !== 'string') pushError(errors, `${path}.surfaceId`, 'must be a string')
  if (value.description !== undefined && typeof value.description !== 'string') {
    pushError(errors, `${path}.description`, 'must be a string when present')
  }
}

function validateDataStore(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.domainName !== 'string') pushError(errors, `${path}.domainName`, 'must be a string')
  validateEnum(value.dataClassification, `${path}.dataClassification`, DATA_CLASSIFICATIONS, errors)
}

function validateMigration(value: unknown, path: string, errors: ManifestValidationError[]): void {
  if (!isRecord(value)) { pushError(errors, path, 'must be an object'); return }
  if (typeof value.fromVersion !== 'number') pushError(errors, `${path}.fromVersion`, 'must be a number')
  if (typeof value.toVersion !== 'number') pushError(errors, `${path}.toVersion`, 'must be a number')
  if (typeof value.description !== 'string') pushError(errors, `${path}.description`, 'must be a string')
}

/**
 * Validate an `unknown` value against the {@link PluginManifestV2} schema.
 * Real structural validation, not a type assertion: every must[0] field
 * shape and every must[1] Tool/MCP effect field is checked, and every JSON
 * value nested anywhere in `value` is checked for must[2]'s
 * static-data property via {@link assertJsonSerializable}.
 * @param value - candidate manifest, typically `JSON.parse`d from `package.json`'s `dsh` field.
 * @returns the narrowed {@link PluginManifestV2} on success, or every validation error found.
 */
export function validatePluginManifestV2(value: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = []
  if (!isRecord(value)) {
    return { valid: false, errors: [{ path: '', message: 'must be an object' }] }
  }
  if (value.manifestVersion !== 2) {
    pushError(errors, 'manifestVersion', 'must be exactly 2')
  }
  if (value.services !== undefined) {
    if (!Array.isArray(value.services)) pushError(errors, 'services', 'must be an array when present')
    else value.services.forEach((item, index) => { validateService(item, `services[${index}]`, errors) })
  }
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools)) pushError(errors, 'tools', 'must be an array when present')
    else value.tools.forEach((item, index) => { validateTool(item, `tools[${index}]`, errors) })
  }
  if (value.skills !== undefined) {
    if (!Array.isArray(value.skills)) pushError(errors, 'skills', 'must be an array when present')
    else value.skills.forEach((item, index) => { validateSkill(item, `skills[${index}]`, errors) })
  }
  if (value.mcp !== undefined) {
    if (!isRecord(value.mcp) || !Array.isArray(value.mcp.servers)) {
      pushError(errors, 'mcp.servers', 'must be an array when "mcp" is present')
    } else {
      value.mcp.servers.forEach((item, index) => { validateMcpServer(item, `mcp.servers[${index}]`, errors) })
    }
  }
  if (value.events !== undefined) {
    if (!Array.isArray(value.events)) pushError(errors, 'events', 'must be an array when present')
    else value.events.forEach((item, index) => { validateEvent(item, `events[${index}]`, errors) })
  }
  if (value.filesystem !== undefined) {
    if (!isRecord(value.filesystem)) {
      pushError(errors, 'filesystem', 'must be an object when present')
    } else {
      validateStringArray(value.filesystem.readPaths, 'filesystem.readPaths', errors)
      validateStringArray(value.filesystem.writePaths, 'filesystem.writePaths', errors)
    }
  }
  if (value.network !== undefined) {
    if (!isRecord(value.network)) pushError(errors, 'network', 'must be an object when present')
    else validateStringArray(value.network.hostPatterns, 'network.hostPatterns', errors)
  }
  if (value.process !== undefined) {
    if (!isRecord(value.process)) pushError(errors, 'process', 'must be an object when present')
    else validateStringArray(value.process.commandPatterns, 'process.commandPatterns', errors)
  }
  if (value.secrets !== undefined) {
    if (!Array.isArray(value.secrets)) pushError(errors, 'secrets', 'must be an array when present')
    else value.secrets.forEach((item, index) => { validateSecret(item, `secrets[${index}]`, errors) })
  }
  if (value.uiSurfaces !== undefined) {
    if (!Array.isArray(value.uiSurfaces)) pushError(errors, 'uiSurfaces', 'must be an array when present')
    else value.uiSurfaces.forEach((item, index) => { validateUiSurface(item, `uiSurfaces[${index}]`, errors) })
  }
  if (value.dataStores !== undefined) {
    if (!Array.isArray(value.dataStores)) pushError(errors, 'dataStores', 'must be an array when present')
    else value.dataStores.forEach((item, index) => { validateDataStore(item, `dataStores[${index}]`, errors) })
  }
  if (value.migrations !== undefined) {
    if (!Array.isArray(value.migrations)) pushError(errors, 'migrations', 'must be an array when present')
    else value.migrations.forEach((item, index) => { validateMigration(item, `migrations[${index}]`, errors) })
  }
  validateEnum(value.executionMode, 'executionMode', EXECUTION_MODES, errors)
  if (!isRecord(value.compatibility) || typeof value.compatibility.dshVersionRange !== 'string') {
    pushError(errors, 'compatibility.dshVersionRange', 'must be a string')
  }
  assertJsonSerializable(value, '', errors)
  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, manifest: value as unknown as PluginManifestV2 }
}

/**
 * Recognize the legacy `dsh.bundle`-only shape for compatibility (must[3]):
 * `{ bundle: { patch: string } }`, the real `dsh.bundle` field content this
 * repo's own `packages/bundle/*` packages already carry. Returns `undefined`
 * for anything else, including a v2 manifest (callers check
 * {@link validatePluginManifestV2} first).
 * @param dshField - the candidate `package.json` `dsh` field value.
 * @returns a {@link LegacyBundleDeclaration} tagged `legacy-untrusted`, or `undefined`.
 */
export function parseLegacyBundleDeclaration(dshField: unknown): LegacyBundleDeclaration | undefined {
  if (!isRecord(dshField)) return undefined
  const bundle = dshField.bundle
  if (!isRecord(bundle) || typeof bundle.patch !== 'string') return undefined
  return { trust: 'legacy-untrusted', patch: bundle.patch }
}

/**
 * Classify a `package.json` `dsh` field into the three states must[3]/
 * acceptance[0] distinguish: a valid v2 manifest, a legacy bundle (always
 * `legacy-untrusted`), or missing. A `dsh.manifestVersion === 2` field that
 * fails schema validation is reported as `'missing'` — a malformed manifest
 * carries no trustworthy declaration, the same as no manifest at all; a
 * caller that needs the specific validation errors calls
 * {@link validatePluginManifestV2} directly.
 * @param dshField - the candidate `package.json` `dsh` field value.
 * @returns the classified {@link PluginDeclaration}.
 */
export function classifyPluginDeclaration(dshField: unknown): PluginDeclaration {
  if (isRecord(dshField) && dshField.manifestVersion === 2) {
    const result = validatePluginManifestV2(dshField)
    if (result.valid) return { kind: 'manifest-v2', manifest: result.manifest }
    return { kind: 'missing' }
  }
  const legacy = parseLegacyBundleDeclaration(dshField)
  if (legacy !== undefined) return { kind: 'legacy-untrusted', legacy }
  return { kind: 'missing' }
}

/**
 * Whether a classified declaration is denied by default in a production
 * profile (must[3]: "旧 dsh.bundle 兼容读取但标记 legacy-untrusted，生产 profile
 * 默认拒绝" / the old dsh.bundle format is read for compatibility but marked
 * legacy-untrusted, production profiles reject it by default). A missing
 * declaration is likewise rejected (acceptance[0]): there is no weaker
 * category than "no declared permission surface at all."
 * @param declaration - a value {@link classifyPluginDeclaration} returned.
 * @returns whether a production profile denies this declaration by default.
 */
export function isDeniedInProductionByDefault(declaration: PluginDeclaration): boolean {
  return declaration.kind !== 'manifest-v2'
}

function collectDestinations(manifest: PluginManifestV2): readonly { path: string; destination: CapabilityDestination }[] {
  const found: { path: string; destination: CapabilityDestination }[] = []
  const collectEffect = (effect: CapabilityEffectDeclaration, path: string): void => {
    effect.allowedDestinations.forEach((destination, index) => {
      found.push({ path: `${path}.allowedDestinations[${index}]`, destination })
    })
  }
  manifest.tools?.forEach((tool, index) => { collectEffect(tool, `tools[${index}]`) })
  manifest.mcp?.servers.forEach((server, index) => { collectEffect(server, `mcp.servers[${index}]`) })
  manifest.skills?.forEach((skill, index) => {
    if (skill.remoteProvider !== undefined) collectEffect(skill.remoteProvider, `skills[${index}].remoteProvider`)
  })
  return found
}

function patternOf(destination: CapabilityDestination): string {
  switch (destination.kind) {
    case 'filesystem': return destination.pathPattern
    case 'network': return destination.hostPattern
    case 'process': return destination.commandPattern
    /* v8 ignore next -- CapabilityDestination is a closed union; a future kind must fail compilation here. */
    default: return assertNever(destination, 'CapabilityDestination.kind')
  }
}

/**
 * Find every {@link CapabilityDestination} across a manifest's Tool, MCP
 * server, and remote-Skill-provider declarations whose pattern is
 * maximally broad (`'*'`, `'**'`, or `'/'`) — acceptance[0]'s "申请通配权限"
 * (requesting wildcard permission), which a later P/U-stage installer fails
 * or quarantines. Pure schema-level detection only: this does not compare
 * against an actual Cordis registry (a P/U-stage runtime concern).
 * @param manifest - a validated {@link PluginManifestV2}.
 * @returns every wildcard finding, empty when the manifest requests none.
 */
export function detectWildcardPermissions(manifest: PluginManifestV2): readonly WildcardFinding[] {
  return collectDestinations(manifest)
    .map(({ path, destination }) => ({ path, pattern: patternOf(destination) }))
    .filter(({ pattern }) => WILDCARD_PATTERNS.has(pattern))
}
