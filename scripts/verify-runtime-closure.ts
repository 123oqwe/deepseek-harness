/**
 * Verify that the executable deploy manifest supplies what the carrier loads.
 * The carrier is deployed with automatic peer installation disabled, and its
 * build restores only the manifest's direct dependencies, so a package the
 * manifest does not declare can be absent from the carrier; the omission then
 * fails only when the packaged runtime starts. Three checks:
 * - every plugin a shipped agent preset references, and every non-optional
 *   workspace peer in the manifest's workspace dependency graph;
 * - for each profile the carrier runs, every workspace package its start loads
 *   (the bootstrap's imports, the profile's bundles, their enabled plugin rows,
 *   and those packages' source value imports, transitively) and every
 *   non-optional workspace peer of those packages;
 * - every non-optional peer in the lockfile's deploy closure is installed by a
 *   package of that closure.
 */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import * as yaml from 'js-yaml'
import ts from 'typescript'
import { isCordisGroupEntry, loadCordisYaml } from './cordis-yaml.ts'
import { collectRuntimeSourcePackageUses } from './verify-client-packages.ts'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  dsh?: { bundle?: { patch?: string } }
}

interface WorkspacePackage {
  path: string
  manifest: PackageManifest
}

interface RuntimePlatform {
  tag: string
  executable: string
}

type RuntimePlatformManifest = Record<string, RuntimePlatform>

const AGENT_PRESET_GLOB = 'packages/preset/agent-presets/presets/*/agent.cordis.yml'

/** The source whose `PROFILE_TEMPLATES` literal names each shipped profile's bundles. */
const PROFILE_TEMPLATE_SOURCE = 'packages/boot/app-boot/src/profile.ts'

/** The carrier's entry module, beside the runtime manifest; its imports start every profile. */
const CARRIER_BOOTSTRAP = 'runtime-bootstrap.mjs'

/**
 * Shipped profiles the carrier does not run, each with the reason the check
 * prints. Every other `PROFILE_TEMPLATES` entry is checked, so a new profile is
 * covered without an edit here.
 */
const CARRIER_EXCLUDED_PROFILES: ReadonlyMap<string, string> = new Map([
  ['web', 'its client packages import packages they do not declare as runtime dependencies'],
])

/** Workspace manifests the start closure resolves imports against, applications included. */
const START_WORKSPACE_GLOBS = ['apps/*/package.json', 'packages/*/*/package.json', 'vendor/*/package.json']

/** Source files a package's start can load; tests and declaration files are not loaded. */
const RUNTIME_SOURCE_GLOB = 'src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'
const NON_RUNTIME_SOURCE = /\.(spec|test|e2e)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/u

export interface RuntimeClosureResult {
  failures: string[]
  presetCount: number
  workspacePackageCount: number
}

/** What {@link verifyCarrierProfiles} checked and found. */
export interface CarrierProfileResult {
  failures: string[]
  /** Profiles the carrier runs, in template order. */
  profiles: string[]
  /** Profiles excluded by name, each with its reason. */
  excludedProfiles: string[]
  /** Workspace packages any checked profile's start loads. */
  startPackageCount: number
}

/** What {@link verifyDeployClosurePeers} checked and found. */
export interface DeployClosurePeerResult {
  failures: string[]
  /** Third-party packages in the lockfile's deploy closure. */
  packageCount: number
}

/**
 * Check that the runtime manifest contains every shipped-preset plugin and workspace peer.
 * @param root repository root containing the runtime manifest and shipped presets.
 * @param manifestPath runtime manifest path relative to {@link root}.
 * @returns the discovered preset count, reachable workspace package count, and violations.
 */
export async function verifyRuntimeClosure(
  root: string,
  manifestPath = 'python/sdk-runtime/package.json',
): Promise<RuntimeClosureResult> {
  const runtimeManifest = await loadManifest(resolve(root, manifestPath))
  const runtimeName = runtimeManifest.name ?? manifestPath
  const workspace = await loadWorkspacePackages(root)
  const runtimeDependencies = runtimeManifest.dependencies ?? {}
  const platforms = await loadJson<RuntimePlatformManifest>(resolve(root, 'python/sdk-runtime/platforms.json'))
  const presetPaths = globSync(AGENT_PRESET_GLOB, { cwd: root }).sort()
  const targets = Object.keys(platforms).sort()
  const parents = new Map<string, string | undefined>()
  const queue: string[] = []

  for (const dependency of Object.keys(runtimeDependencies).sort()) {
    if (!workspace.has(dependency)) continue
    parents.set(dependency, undefined)
    queue.push(dependency)
  }

  const failures: string[] = []
  if (presetPaths.length === 0) failures.push(`no agent presets matched ${AGENT_PRESET_GLOB}`)
  if (targets.length === 0) failures.push('python/sdk-runtime/platforms.json defines no runtime targets')
  failures.push(...await missingPresetPlugins(root, runtimeDependencies, presetPaths, targets))
  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index]
    if (packageName === undefined) continue
    const current = workspace.get(packageName)
    if (current === undefined) continue
    const peers = current.manifest.peerDependencies ?? {}
    const peerMeta = current.manifest.peerDependenciesMeta ?? {}
    for (const peer of Object.keys(peers).sort()) {
      if (!workspace.has(peer) || peerMeta[peer]?.optional === true) continue
      if (runtimeDependencies[peer]?.startsWith('workspace:') === true) continue
      failures.push(`${formatChain(runtimeName, packageName, parents)} -> ${peer}`)
    }
    const dependencies = {
      ...current.manifest.dependencies,
      ...current.manifest.optionalDependencies,
    }
    for (const dependency of Object.keys(dependencies).sort()) {
      if (!workspace.has(dependency) || parents.has(dependency)) continue
      parents.set(dependency, packageName)
      queue.push(dependency)
    }
  }

  return {
    failures,
    presetCount: presetPaths.length,
    workspacePackageCount: queue.length,
  }
}

/**
 * Check that the runtime manifest declares, as `workspace:` dependencies, every
 * workspace package a carrier profile loads at start and every non-optional
 * workspace peer of those packages. A profile's start is the bootstrap's
 * imports, the profile's bundles, the plugin rows their patches leave enabled
 * on at least one runtime target, and the value imports of those packages'
 * sources, followed through workspace packages, applications included.
 * Type-only imports are not followed; every other import is, so the check can
 * require a package the bundler inlines but never misses one the start loads.
 * @param root - repository root.
 * @param manifestPath - runtime manifest path relative to {@link root}; the bootstrap and platform manifest sit beside it.
 * @returns the violations, the profiles checked and excluded, and how many workspace packages their starts load.
 */
export async function verifyCarrierProfiles(
  root: string,
  manifestPath = 'python/sdk-runtime/package.json',
): Promise<CarrierProfileResult> {
  const runtimeManifest = await loadManifest(resolve(root, manifestPath))
  const runtimeName = runtimeManifest.name ?? manifestPath
  const runtimeDependencies = runtimeManifest.dependencies ?? {}
  const declared = (name: string): boolean => runtimeDependencies[name]?.startsWith('workspace:') === true
  const workspace = await loadWorkspacePackages(root, START_WORKSPACE_GLOBS)
  const carrierDir = dirname(manifestPath)
  const platforms = await loadJson<RuntimePlatformManifest>(resolve(root, carrierDir, 'platforms.json'))
  const targets = Object.keys(platforms).sort()
  const templates = await profileTemplates(root)
  const failures: string[] = []
  for (const name of CARRIER_EXCLUDED_PROFILES.keys()) {
    if (!templates.has(name)) failures.push(`${PROFILE_TEMPLATE_SOURCE} has no profile ${name}, which the carrier exclusions name`)
  }
  const bootstrap = join(carrierDir, CARRIER_BOOTSTRAP)
  const starts = [...collectRuntimeSourcePackageUses(bootstrap, await readFile(resolve(root, bootstrap), 'utf8'))]
    .filter(name => workspace.has(name))
    .sort()
  if (starts.length === 0) failures.push(`${bootstrap} imports no workspace package`)

  const importCache = new Map<string, ReadonlySet<string>>()
  const missing = new Map<string, { chain: string; profiles: string[] }>()
  const note = (key: string, chain: string, profile: string): void => {
    const known = missing.get(key)
    if (known === undefined) missing.set(key, { chain, profiles: [profile] })
    else if (!known.profiles.includes(profile)) known.profiles.push(profile)
  }
  const loaded = new Set<string>()
  const profiles: string[] = []
  for (const [profile, bundles] of templates) {
    if (CARRIER_EXCLUDED_PROFILES.has(profile)) continue
    profiles.push(profile)
    const origins = new Map<string, string>()
    for (const name of starts) origins.set(name, CARRIER_BOOTSTRAP)
    for (const bundle of bundles) if (!origins.has(bundle)) origins.set(bundle, 'bundle')
    const rows = await bundleRows(root, workspace, bundles, failures)
    for (const plugin of enabledRowPackages(rows, targets)) if (!origins.has(plugin)) origins.set(plugin, 'plugin row')
    const parents = new Map<string, string | undefined>([...origins.keys()].map(name => [name, undefined]))
    const chainOf = (name: string): string => {
      const chain = [name]
      let parent = parents.get(name)
      while (parent !== undefined) {
        chain.unshift(parent)
        parent = parents.get(parent)
      }
      const first = chain[0] ?? name
      return [runtimeName, `${profile} profile ${origins.get(first) ?? ''}`.trimEnd(), ...chain].join(' -> ')
    }
    const queue = [...origins.keys()]
    for (let index = 0; index < queue.length; index += 1) {
      const name = queue[index]
      if (name === undefined) continue
      const current = workspace.get(name)
      if (current === undefined) {
        if (runtimeDependencies[name] === undefined) note(name, chainOf(name), profile)
        continue
      }
      loaded.add(name)
      if (!declared(name)) note(name, chainOf(name), profile)
      for (const peer of nonOptionalWorkspacePeers(current, workspace)) {
        if (!declared(peer)) note(`${name} -> ${peer}`, `${chainOf(name)} -> ${peer}`, profile)
      }
      for (const imported of await valueImportPackages(current, importCache)) {
        if (!workspace.has(imported) || parents.has(imported)) continue
        parents.set(imported, name)
        queue.push(imported)
      }
    }
  }
  for (const { chain, profiles: seenIn } of missing.values()) failures.push(`${chain} (${seenIn.join(', ')})`)
  return {
    // A peer that a package also imports is reached twice with the same chain.
    failures: [...new Set(failures)],
    profiles,
    excludedProfiles: [...CARRIER_EXCLUDED_PROFILES].map(([name, reason]) => `${name}, because ${reason}`),
    startPackageCount: loaded.size,
  }
}

/**
 * Check the lockfile's deploy closure for a non-optional peer that no package
 * of the closure installs. The closure is what pnpm installs for the runtime
 * manifest's importer: its dependencies, followed through workspace links and
 * package snapshots, where a snapshot's entry for one of its own peers is not
 * followed, because the carrier is deployed without automatic peer
 * installation.
 * @param root - repository root.
 * @param manifestPath - runtime manifest path relative to {@link root}; its directory is the lockfile importer.
 * @param lockfilePath - lockfile path relative to {@link root}.
 * @returns the violations and the number of package snapshots in the closure.
 */
export async function verifyDeployClosurePeers(
  root: string,
  manifestPath = 'python/sdk-runtime/package.json',
  lockfilePath = 'pnpm-lock.yaml',
): Promise<DeployClosurePeerResult> {
  const lock: unknown = yaml.load(await readFile(resolve(root, lockfilePath), 'utf8'))
  const importers = isRecord(lock) ? lock.importers : undefined
  const packages = isRecord(lock) ? lock.packages : undefined
  const snapshots = isRecord(lock) ? lock.snapshots : undefined
  if (!isRecord(importers) || !isRecord(packages) || !isRecord(snapshots)) {
    return { failures: [`${lockfilePath} has no importers, packages and snapshots maps`], packageCount: 0 }
  }
  const failures: string[] = []
  const installed = new Set<string>()
  const visitedImporters = new Set<string>()
  const visitedSnapshots = new Set<string>()
  const importerQueue = [relative(root, resolve(root, dirname(manifestPath))).split(sep).join('/')]
  const snapshotQueue: string[] = []
  const follow = (dependencies: unknown, importer: string | undefined, peers: ReadonlySet<string>): void => {
    if (!isRecord(dependencies)) return
    for (const [name, entry] of Object.entries(dependencies)) {
      if (peers.has(name)) continue
      installed.add(name)
      const version = typeof entry === 'string' ? entry : isRecord(entry) && typeof entry.version === 'string' ? entry.version : undefined
      if (version === undefined) continue
      if (version.startsWith('link:')) {
        if (importer !== undefined) importerQueue.push(posix.normalize(posix.join(importer, version.slice('link:'.length))))
        continue
      }
      // An aliased entry is itself `name@version(peers)`; a plain one is `version(peers)`.
      snapshotQueue.push((version.split('(')[0] ?? '').lastIndexOf('@') > 0 ? version : `${name}@${version}`)
    }
  }
  while (importerQueue.length > 0 || snapshotQueue.length > 0) {
    const importer = importerQueue.pop()
    if (importer !== undefined) {
      if (visitedImporters.has(importer)) continue
      visitedImporters.add(importer)
      const record = importers[importer]
      if (!isRecord(record)) {
        failures.push(`${lockfilePath} has no importer ${importer}`)
        continue
      }
      follow(record.dependencies, importer, new Set())
      follow(record.optionalDependencies, importer, new Set())
      continue
    }
    const key = snapshotQueue.pop()
    if (key === undefined || visitedSnapshots.has(key)) continue
    visitedSnapshots.add(key)
    const snapshot = snapshots[key]
    if (!isRecord(snapshot)) {
      failures.push(`${lockfilePath} has no snapshot ${key}`)
      continue
    }
    const described = packages[snapshotPackageKey(key)]
    const ownPeers = new Set(isRecord(described) && isRecord(described.peerDependencies) ? Object.keys(described.peerDependencies) : [])
    follow(snapshot.dependencies, undefined, ownPeers)
    follow(snapshot.optionalDependencies, undefined, ownPeers)
  }
  for (const key of [...visitedSnapshots].sort()) {
    const described = packages[snapshotPackageKey(key)]
    if (!isRecord(described) || !isRecord(described.peerDependencies)) continue
    const meta: Record<string, unknown> = isRecord(described.peerDependenciesMeta) ? described.peerDependenciesMeta : {}
    for (const peer of Object.keys(described.peerDependencies).sort()) {
      const peerMeta = meta[peer]
      if ((isRecord(peerMeta) && peerMeta.optional === true) || installed.has(peer)) continue
      failures.push(`${lockfilePath}: ${snapshotPackageKey(key)} -> ${peer} (a non-optional peer no package of the deploy closure installs)`)
    }
  }
  return { failures: [...new Set(failures)], packageCount: visitedSnapshots.size }
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..')
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { manifest: { type: 'string' } },
  })
  const result = await verifyRuntimeClosure(root, values.manifest)
  const carrier = await verifyCarrierProfiles(root, values.manifest)
  const peers = await verifyDeployClosurePeers(root, values.manifest)
  const failures = [...result.failures, ...carrier.failures, ...peers.failures]
  if (failures.length > 0) {
    console.error('verify-runtime-closure: the runtime manifest does not supply everything the carrier loads:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log(
      `verify-runtime-closure: ${result.presetCount} agent presets and ${result.workspacePackageCount} workspace packages form a closed runtime dependency graph;`
      + ` the ${carrier.profiles.join(', ')} profiles load ${carrier.startPackageCount} workspace packages at start, all declared`
      + ` (not run on the carrier: ${carrier.excludedProfiles.join('; ')});`
      + ` every non-optional peer of the lockfile's ${peers.packageCount}-package deploy closure is installed.`,
    )
  }
}

async function missingPresetPlugins(
  root: string,
  runtimeDependencies: Readonly<Record<string, string>>,
  presetPaths: readonly string[],
  targets: readonly string[],
): Promise<string[]> {
  const missing = new Map<string, Set<string>>()
  const failures: string[] = []
  for (const presetPath of presetPaths) {
    const document = loadCordisYaml(await readFile(resolve(root, presetPath), 'utf8'))
    if (!Array.isArray(document)) {
      failures.push(`${presetPath}: preset root must be a Loader entry array`)
      continue
    }
    for (const target of targets) {
      const processPlatform = processPlatformForTarget(target)
      for (const plugin of activeBarePluginPackages(document, processPlatform)) {
        const version = runtimeDependencies[plugin]
        if (version?.startsWith('workspace:') === true) continue
        const preset = basename(dirname(presetPath))
        const declaration = version === undefined
          ? ''
          : ` [runtime dependency is ${JSON.stringify(version)}; expected workspace:]`
        const key = `${preset} preset -> ${plugin}${declaration}`
        const targets = missing.get(key) ?? new Set<string>()
        targets.add(target)
        missing.set(key, targets)
      }
    }
  }
  failures.push(...[...missing.entries()].map(([chain, targets]) =>
    `${chain} (${[...targets].sort().join(', ')})`))
  return failures
}

function activeBarePluginPackages(entries: unknown[], processPlatform: string): Set<string> {
  const packages = new Set<string>()
  const visit = (value: unknown, parentDisabled: boolean): void => {
    if (!isRecord(value)) return
    const disabled = parentDisabled || disabledOnPlatform(value.disabled, processPlatform)
    if (disabled) return
    if (typeof value.name === 'string') {
      const packageName = barePackageName(value.name)
      if (packageName !== undefined) packages.add(packageName)
    }
    if (isCordisGroupEntry(value)) {
      for (const child of value.config) visit(child, disabled)
    }
  }
  for (const entry of entries) visit(entry, false)
  return packages
}

function disabledOnPlatform(value: unknown, processPlatform: string): boolean {
  if (typeof value === 'boolean') return value
  if (!isRecord(value) || typeof value.__jsExpr !== 'string') return false
  const match = /^process\.platform\s*(===|!==)\s*(['"])(win32|linux|darwin)\2$/.exec(value.__jsExpr.trim())
  if (match === null) return false
  const [, operator, , expected] = match
  return operator === '===' ? processPlatform === expected : processPlatform !== expected
}

function processPlatformForTarget(target: string): string {
  if (target.startsWith('linux-')) return 'linux'
  if (target.startsWith('macos-')) return 'darwin'
  if (target.startsWith('win-')) return 'win32'
  throw new Error(`verify-runtime-closure: unsupported runtime target ${JSON.stringify(target)}`)
}

function barePackageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) return undefined
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
  }
  return parts[0] || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadWorkspacePackages(
  root: string,
  globs: readonly string[] = ['packages/*/*/package.json', 'vendor/*/package.json'],
): Promise<Map<string, WorkspacePackage>> {
  const paths = globSync([...globs], { cwd: root })
    .sort()
    .map(relative => resolve(root, relative))
  const result = new Map<string, WorkspacePackage>()
  for (const path of paths) {
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, { path, manifest })
  }
  return result
}

async function loadManifest(path: string): Promise<PackageManifest> {
  return loadJson<PackageManifest>(path)
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function formatChain(
  runtimeName: string,
  packageName: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  const chain = [packageName]
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [runtimeName, ...chain].join(' -> ')
}

/** One Loader row after the bundle patches, as far as the start check reads it. */
interface CompositionRow {
  name: string | undefined
  /** Whether an `insert` patch may target this row (the include plugin's `group` field). */
  insertable: boolean
  disabled: unknown
  children: CompositionRow[]
}

/**
 * Read the `PROFILE_TEMPLATES` object literal: each profile's name and bundles.
 * A shape it cannot read throws, because an unread template would leave its
 * profile unchecked.
 */
async function profileTemplates(root: string): Promise<Map<string, string[]>> {
  const path = resolve(root, PROFILE_TEMPLATE_SOURCE)
  const file = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const find = (node: ts.Node): ts.ObjectLiteralExpression | undefined => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'PROFILE_TEMPLATES'
      && node.initializer !== undefined && ts.isObjectLiteralExpression(node.initializer)) return node.initializer
    return ts.forEachChild(node, find)
  }
  const literal = find(file)
  if (literal === undefined) throw new Error(`verify-runtime-closure: ${PROFILE_TEMPLATE_SOURCE} has no PROFILE_TEMPLATES object literal`)
  const templates = new Map<string, string[]>()
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)
      || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      throw new Error(`verify-runtime-closure: ${PROFILE_TEMPLATE_SOURCE}: a PROFILE_TEMPLATES entry is not a named object literal`)
    }
    const name = property.name.text
    let bundles: string[] | undefined
    for (const field of property.initializer.properties) {
      if (!ts.isPropertyAssignment(field) || !ts.isIdentifier(field.name) || field.name.text !== 'bundles') continue
      if (!ts.isArrayLiteralExpression(field.initializer)) break
      bundles = field.initializer.elements.map((element) => {
        if (!ts.isStringLiteral(element)) throw new Error(`verify-runtime-closure: ${PROFILE_TEMPLATE_SOURCE}: profile ${name} names a bundle that is not a string literal`)
        return element.text
      })
    }
    if (bundles === undefined) throw new Error(`verify-runtime-closure: ${PROFILE_TEMPLATE_SOURCE}: profile ${name} has no bundles array literal`)
    templates.set(name, bundles)
  }
  return templates
}

/**
 * Compose the Loader rows of a profile's bundles, applying each bundle's patch
 * list in order the way `@deepseek-ai/cordis-plugin-include` does: an `insert`
 * appends at the root, or into the group its `id` names; an id-targeted patch
 * replaces fields of that row, and is skipped when its `name` differs from the
 * row's. A patch the include plugin would skip with a warning is skipped here.
 */
async function bundleRows(
  root: string,
  workspace: ReadonlyMap<string, WorkspacePackage>,
  bundles: readonly string[],
  failures: string[],
): Promise<CompositionRow[]> {
  const rows: CompositionRow[] = []
  const byId = new Map<string, CompositionRow>()
  const record = (entry: unknown, into: CompositionRow[]): void => {
    if (!isRecord(entry)) return
    const row: CompositionRow = {
      name: typeof entry.name === 'string' ? entry.name : undefined,
      insertable: entry.group === true,
      disabled: entry.disabled,
      children: [],
    }
    into.push(row)
    if (typeof entry.id === 'string') byId.set(entry.id, row)
    if (isCordisGroupEntry(entry)) for (const child of entry.config) record(child, row.children)
  }
  for (const bundle of bundles) {
    const current = workspace.get(bundle)
    const patchFile = current?.manifest.dsh?.bundle?.patch
    if (current === undefined || patchFile === undefined) {
      failures.push(`profile bundle ${bundle} is not a workspace package with a dsh.bundle.patch`)
      continue
    }
    const patches = loadCordisYaml(await readFile(resolve(dirname(current.path), patchFile), 'utf8'))
    if (!Array.isArray(patches)) {
      failures.push(`${relative(root, resolve(dirname(current.path), patchFile))}: a bundle patch must be an array`)
      continue
    }
    for (const patch of patches) {
      if (!isRecord(patch)) continue
      const target = typeof patch.id === 'string' ? byId.get(patch.id) : undefined
      if (Array.isArray(patch.insert)) {
        if (typeof patch.id === 'string' && target?.insertable !== true) continue
        for (const entry of patch.insert) record(entry, target?.children ?? rows)
        continue
      }
      if (target === undefined || (typeof patch.name === 'string' && patch.name !== target.name)) continue
      if ('disabled' in patch) target.disabled = patch.disabled
      if (target.insertable && Array.isArray(patch.config)) {
        target.children = []
        for (const child of patch.config) record(child, target.children)
      }
    }
  }
  return rows
}

/** The plugin packages of rows enabled on at least one runtime target; a disabled group disables its rows. */
function enabledRowPackages(rows: readonly CompositionRow[], targets: readonly string[]): Set<string> {
  const packages = new Set<string>()
  for (const target of targets) {
    const processPlatform = processPlatformForTarget(target)
    const visit = (row: CompositionRow): void => {
      if (disabledOnPlatform(row.disabled, processPlatform)) return
      const packageName = row.name === undefined ? undefined : barePackageName(row.name)
      if (packageName !== undefined) packages.add(packageName)
      for (const child of row.children) visit(child)
    }
    for (const row of rows) visit(row)
  }
  return packages
}

/** A package's peers that are workspace packages and not marked optional. */
function nonOptionalWorkspacePeers(current: WorkspacePackage, workspace: ReadonlyMap<string, WorkspacePackage>): string[] {
  const meta = current.manifest.peerDependenciesMeta ?? {}
  return Object.keys(current.manifest.peerDependencies ?? {})
    .filter(peer => workspace.has(peer) && meta[peer]?.optional !== true)
    .sort()
}

/** The packages a workspace package's runtime sources import by value, cached per package. */
async function valueImportPackages(
  current: WorkspacePackage,
  cache: Map<string, ReadonlySet<string>>,
): Promise<ReadonlySet<string>> {
  const cached = cache.get(current.path)
  if (cached !== undefined) return cached
  const dir = dirname(current.path)
  const found = new Set<string>()
  for (const file of globSync(RUNTIME_SOURCE_GLOB, { cwd: dir }).sort()) {
    if (NON_RUNTIME_SOURCE.test(file) || file.split(sep).includes('__tests__')) continue
    for (const packageName of collectRuntimeSourcePackageUses(file, await readFile(join(dir, file), 'utf8'))) found.add(packageName)
  }
  cache.set(current.path, found)
  return found
}

/** The lockfile `packages` key of a snapshot key: the snapshot key without its resolved-peer suffix. */
function snapshotPackageKey(key: string): string {
  const suffix = key.indexOf('(')
  return suffix === -1 ? key : key.slice(0, suffix)
}
