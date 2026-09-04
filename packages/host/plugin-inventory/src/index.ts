/**
 * Read-only projection of the current Cordis Loader plugin entries, and
 * (Epic P1-01.U) the real `ObservedPluginCapabilities`/`PluginPermissionState`
 * builders every product surface calls to see a live plugin's declared vs.
 * actually observed permissions (acceptance[1]).
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Context, Fiber, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the optional agent-preset roster resolved through `ctx.get`.
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  classifyPluginDeclaration,
  compareDeclaredToObserved,
  decidePluginTrust,
  type ObservedPluginCapabilities,
  type PluginDeclaration,
} from '@deepseek-ai/dsh-plugin-manifest'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  AgentPresetPluginGroup,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
  PluginManifestDigest,
  PluginPackageIdentity,
  PluginPermissionState,
  PluginProvenance,
} from './types.ts'
import { recordUnverifiedProvenance } from '@deepseek-ai/dsh-plugin-provenance'
import type { ProvenanceAuditRecord } from '@deepseek-ai/dsh-plugin-provenance'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/**
 * Whether `fiber` is `root` itself or mounted anywhere inside `root`'s
 * subtree. Compares by `Fiber.uid` — a live `Fiber` reached through a
 * different path (e.g. a `Loader` `Entry.fiber` vs. one recorded on a
 * `ReflectService` `Impl`) is not always the identical object even when it
 * names the same live fiber, so `===` reference equality is not reliable
 * here; `uid` is. Walks `Fiber.parent.fiber` toward the root until it stops
 * changing (the technique `@deepseek-ai/dsh-tool-cordis`'s own `withinFiber`
 * uses — a model-facing extension this host package must not depend on, so
 * this is a local, uid-compared copy).
 */
function withinFiber(fiber: Fiber, root: Fiber): boolean {
  let current = fiber
  while (true) {
    if (current.uid === root.uid) return true
    const parent = current.parent.fiber
    if (parent.uid === current.uid) return false
    current = parent
  }
}

/** Every live service `Impl` currently registered in `ctx`'s global reflect store, keyed by the fiber that provided it. */
function liveImpls(ctx: Context): { name: string; fiber: Fiber }[] {
  const store = ctx.reflect.store
  return Object.getOwnPropertySymbols(store)
    .map(key => store[key])
    .filter((impl): impl is NonNullable<typeof impl> => impl !== undefined)
}

/**
 * Parse one `Fiber.getEffects()` label of the exact form `` `<call>(<jsonString>)` ``
 * this repo's registrars emit for a named registration: `ctx.provide(name)`
 * and `ctx.on(name)` (`@deepseek-ai/cordis` itself), and `tools.register(name)`/
 * `skills.register(name)` (this epic's label-parameterization companion to
 * `@deepseek-ai/dsh-core-tools`/`@deepseek-ai/dsh-skill`, matching that
 * existing `ctx.provide`/`ctx.on` convention exactly). Returns `undefined`
 * for a label this pattern does not match.
 * @param label - one `EffectMeta.label` from `Fiber.getEffects()`.
 * @param call - the exact call prefix to match, e.g. `'tools.register'`.
 * @returns the registered name, or `undefined`.
 */
function parseNamedEffectLabel(label: string, call: string): string | undefined {
  const prefix = `${call}(`
  if (!label.startsWith(prefix) || !label.endsWith(')')) return undefined
  try {
    const value: unknown = JSON.parse(label.slice(prefix.length, -1))
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** The Loader-entry module name observing an MCP server's real `serverName` requires. */
const MCP_CLIENT_MODULE_NAME = '@deepseek-ai/dsh-mcp-client'

/**
 * Pull one live MCP server's real name from its own Loader entry: one
 * `@deepseek-ai/dsh-mcp-client` entry mounts exactly one server, and its
 * resolved config carries `serverName` directly — no effect-label parsing
 * needed for this category, unlike tools/skills/events. Returns `undefined`
 * for any other module, or one with no resolved `serverName`.
 * @param entry - one Loader entry, `options.name` plus its `fiber.config`.
 * @returns the server's real name, or `undefined` for a non-MCP-client entry or one with no resolved `serverName`.
 */
export function mcpServerNameOf(entry: { options: { name: string }; fiber?: { config?: unknown } }): string | undefined {
  if (entry.options.name !== MCP_CLIENT_MODULE_NAME) return undefined
  const serverName = (entry.fiber?.config as { serverName?: unknown } | undefined)?.serverName
  return typeof serverName === 'string' ? serverName : undefined
}

/**
 * Real Usage-stage `ObservedPluginCapabilities` construction (acceptance[0]/[1]):
 * walk `rootFiber`'s live subtree — its own registrations plus every
 * descendant Loader entry's fiber mounted underneath it (for example a
 * nested MCP-client entry a plugin's own module mounts) — and report what it
 * actually registered into `ctx`, in {@link PluginManifestV2}'s declared
 * vocabulary. See `@deepseek-ai/dsh-plugin-manifest`'s own BLOCKED-027 doc
 * comment (`src/index.ts`) for why this stays identity-only (name presence),
 * never field content: no live registration anywhere in this codebase
 * carries `sideEffectClass`/`authAudience`/`allowedDestinations`/
 * `dataClassification` today.
 * @param ctx - the live, booted root context.
 * @param rootFiber - the plugin entry's own fiber; its subtree is the observed scope.
 * @returns the plugin's actual registrations.
 */
export function buildObservedPluginCapabilities(ctx: Context, rootFiber: Fiber): ObservedPluginCapabilities {
  const ctxKeys = liveImpls(ctx)
    .filter(impl => withinFiber(impl.fiber, rootFiber))
    .map(impl => impl.name)
  const toolNames: string[] = []
  const skillNames: string[] = []
  const eventNames: string[] = []
  const mcpServerNames: string[] = []
  const subtreeFibers = new Set<Fiber>([rootFiber])
  for (const entry of ctx.loader.entries()) {
    if (entry.fiber === undefined || !withinFiber(entry.fiber, rootFiber)) continue
    subtreeFibers.add(entry.fiber)
    const serverName = mcpServerNameOf(entry)
    if (serverName !== undefined) mcpServerNames.push(serverName)
  }
  for (const fiber of subtreeFibers) {
    for (const effect of fiber.getEffects()) {
      const toolName = parseNamedEffectLabel(effect.label, 'tools.register')
      if (toolName !== undefined) toolNames.push(toolName)
      const skillName = parseNamedEffectLabel(effect.label, 'skills.register')
      if (skillName !== undefined) skillNames.push(skillName)
      const eventName = parseNamedEffectLabel(effect.label, 'ctx.on')
      if (eventName !== undefined) eventNames.push(eventName)
    }
  }
  return { ctxKeys, toolNames, skillNames, mcpServerNames, eventNames }
}

/**
 * Resolve one Loader entry module's package root directory the same way
 * `@deepseek-ai/dsh-app-boot`'s bundle resolution does: probe Node's own
 * require-resolution search paths for a directory holding `package.json`.
 * Absent for a `cordis:`-prefixed builtin, which has no package on disk.
 * @param moduleName - the Loader entry's module specifier (`entry.options.name`).
 * @returns the resolved package directory, or `undefined` when unresolvable.
 */
export function resolveEntryPackageDir(moduleName: string): string | undefined {
  if (moduleName.startsWith('cordis:')) return undefined
  for (const searchPath of createRequire(import.meta.url).resolve.paths(moduleName) ?? []) {
    const candidate = join(searchPath, moduleName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * One Loader entry's package identity, classified declaration, and manifest
 * digest, resolved from its on-disk `package.json`. The digest is taken over
 * the same buffer the identity and declaration are parsed from, in one read,
 * so it always describes exactly the bytes the other two facts came from.
 */
function resolveEntryPackage(
  moduleName: string,
  resolvePackageDir: (moduleName: string) => string | undefined,
): {
  identity: PluginPackageIdentity
  declaration: PluginDeclaration
  manifestDigest: PluginManifestDigest
} | undefined {
  const dir = resolvePackageDir(moduleName)
  if (dir === undefined) return undefined
  let bytes: Buffer
  let manifest: { name?: unknown; version?: unknown; dsh?: unknown }
  try {
    bytes = readFileSync(join(dir, 'package.json'))
    manifest = JSON.parse(bytes.toString('utf8')) as typeof manifest
  } catch {
    return undefined
  }
  const name = typeof manifest.name === 'string' ? manifest.name : moduleName
  const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  return {
    identity: { name, version },
    declaration: classifyPluginDeclaration(manifest.dsh),
    manifestDigest: brandString<PluginManifestDigest>(`sha256:${createHash('sha256').update(bytes).digest('hex')}`),
  }
}

/**
 * Epic P1-02's acceptance[2] Inventory half ("Inventory 和审计事件记录验证结果
 * 而不记录密钥"): the plugin-provenance verification state one entry actually
 * has. No package installed in this repository ships a
 * `PackageProvenanceClaim`, so there is nothing to verify and the honest
 * record is `'unverified'` / `'no-provenance-claim'` — not a refusal, which
 * would name a rejection reason none of which is true of these packages.
 *
 * The record is built solely from `recordUnverifiedProvenance`'s return value.
 * Nothing read out of the entry's `package.json` — the raw `dsh` field above
 * all, which is where a signature and key fingerprint would live — reaches it,
 * which is what keeps acceptance[2]'s "而不记录密钥" true at every nesting
 * depth and not merely at the record's top-level field names.
 * @param verifiedAt - ISO 8601 timestamp of when the state was decided.
 * @returns the entry's provenance audit record.
 */
function recordEntryProvenance(verifiedAt: string): ProvenanceAuditRecord {
  return recordUnverifiedProvenance('no-provenance-claim', verifiedAt)
}

/** Options for {@link buildPluginPermissionStates}. */
export interface BuildPluginPermissionStatesOptions {
  /**
   * Package names composed as the booted profile's `dsh.profile.bundles`
   * layer, in order (`apps/cli/src/profile-boot.ts`'s admitted layers) — an
   * entry whose module name appears here gets `provenance.kind: 'bundle'`.
   * Absent when the caller has no profile-layer context (a bare test tree);
   * every entry then reports `'built-in'`.
   */
  readonly bundlePackageNames?: readonly string[]
  /**
   * Resolve one Loader entry module name to its package root directory;
   * defaults to {@link resolveEntryPackageDir}'s real Node resolution.
   * Overridable so a test can point a synthetic module name at a temp
   * directory without needing a real installed package.
   */
  readonly resolvePackageDir?: (moduleName: string) => string | undefined
}

/**
 * Real Usage-stage plugin-inventory composition (acceptance[1]: "Plugin
 * Inventory 能展示声明权限、实际观察权限、版本与来源"): build one
 * {@link PluginPermissionState} per live, non-group Loader entry with a
 * resolvable on-disk package — declared permissions
 * ({@link classifyPluginDeclaration} on the entry's own `package.json` `dsh`
 * field), actually observed permissions ({@link buildObservedPluginCapabilities}),
 * package identity/version, and provenance. A `'manifest-v2'` declaration
 * gets a real `comparison`/`trustDecision` from
 * {@link compareDeclaredToObserved}/{@link decidePluginTrust}; any other
 * declaration kind carries neither, matching `PluginPermissionState`'s own
 * doc comment. An entry with no resolvable package (a `cordis:` builtin, or
 * a module this process cannot resolve) is skipped — there is no
 * `package.json` to report identity or a declaration from.
 * @param ctx - the live, booted root context.
 * @param options - provenance hints from the caller's own boot composition.
 * @returns one permission state per non-group Loader entry with a resolvable package.
 */
export function buildPluginPermissionStates(
  ctx: Context,
  options: BuildPluginPermissionStatesOptions = {},
): PluginPermissionState[] {
  const bundleNames = new Set(options.bundlePackageNames ?? [])
  const resolvePackageDir = options.resolvePackageDir ?? resolveEntryPackageDir
  const states: PluginPermissionState[] = []
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    const resolved = resolveEntryPackage(entry.options.name, resolvePackageDir)
    if (resolved === undefined) continue
    const observed: ObservedPluginCapabilities = entry.fiber === undefined
      ? { ctxKeys: [], toolNames: [], skillNames: [], mcpServerNames: [], eventNames: [] }
      : buildObservedPluginCapabilities(ctx, entry.fiber)
    const provenance: PluginProvenance = bundleNames.has(entry.options.name)
      ? { kind: 'bundle', source: entry.options.name }
      : { kind: 'built-in' }
    const provenanceAudit = recordEntryProvenance(new Date().toISOString())
    const { manifestDigest } = resolved
    if (resolved.declaration.kind === 'manifest-v2') {
      const comparison = compareDeclaredToObserved(resolved.declaration.manifest, observed)
      states.push({
        entryId: pluginEntryId(entry.id),
        packageIdentity: resolved.identity,
        provenance,
        declaration: resolved.declaration,
        observed,
        comparison,
        trustDecision: decidePluginTrust(comparison),
        manifestDigest,
        provenanceAudit,
      })
    } else {
      states.push({
        entryId: pluginEntryId(entry.id),
        packageIdentity: resolved.identity,
        provenance,
        declaration: resolved.declaration,
        observed,
        manifestDigest,
        provenanceAudit,
      })
    }
  }
  return states
}

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   *
   * When an agent-preset roster is composed, the snapshot also carries each
   * preset's composition rows, because those rows — not the Loader's own
   * entries — are where a deployment that mounts the roster runs its
   * model-facing plugins.
   * @returns Current non-group Loader entries in Loader order, with per-preset
   * compositions when a roster is composed.
   */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { entries }
    const agentPresets: AgentPresetPluginGroup[] = (await presets.compositionInventory()).map(
      composition => ({
        ...composition,
        rows: composition.rows.map(({ fiberState, ...row }) => ({
          ...row,
          fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
        })),
      }),
    )
    return { entries, agentPresets }
  }

  // No `@Remote` method exposes `buildPluginPermissionStates` here: the
  // typert Zod-schema emitter cannot serialize `PluginManifestV2`'s
  // non-empty-tuple fields (`readonly [X, ...X[]]`, e.g.
  // `CapabilityEffectDeclaration.authAudience`) — confirmed by a real build
  // failure (`tuple rest element must retain an array type`) when this class
  // carried one. `buildPluginPermissionStates` stays a plain export;
  // `apps/cli/src/profile-boot.ts` calls it directly for
  // acceptance[1]'s real CLI-facing display, and a future Remote surface
  // needs either a typert-generator fix or a serialization-friendly
  // projection of `PluginPermissionState`, neither of which is this stage's job.
}

export default PluginInventoryGateway
