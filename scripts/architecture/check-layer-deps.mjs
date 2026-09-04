/**
 * Real layer-dependency architecture gate (Epic P0-04, U-stage): classifies
 * every real workspace package into `./layer-order.ts`'s six-layer sequence,
 * resolves dependency edges through must[2]'s three detection channels,
 * enforces `docs/architecture/layering.md`'s rules 1-6 against the resolved
 * facts, and searches the real production package graph for an unexempted
 * cycle. Plain ESM (not TypeScript) so it runs the same way as every other
 * tsx-launched gate script while importing the `.ts` contract module
 * directly — see `docs/development.md#typescript-project-layout` on
 * source-plane gates, and `./check-capability-seams.mjs` (Epic P0-03) for
 * the same script shape.
 *
 * Run: `pnpm run architecture:layers` (`tsx scripts/architecture/check-layer-deps.mjs
 * [--repo-root <path>]`). `--repo-root` defaults to this script's own
 * repository root (not `process.cwd()`) and exists for the fixture-driven
 * tests in `tests/architecture/check-layer-deps.spec.ts`.
 *
 * The exemption store this reads is `tests/first100/layer-cycle-exemptions.json`
 * (path patch `P0-04-U-cycle-exemptions`; the root `architecture.layers.json`
 * is P0-03's exclusively owned file). This script never writes it, so the
 * gate cannot widen its own escape hatch.
 */

import { readFileSync, globSync, existsSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import ts from 'typescript'
import { LAYER_ORDER, classifyEdge, findShortestCycle, validateExemptedCycle } from './layer-order.ts'

const GATE = 'check-layer-deps'
const EXEMPTIONS_PATH = 'tests/first100/layer-cycle-exemptions.json'
const PACKAGE_MAP_PATH = 'tests/first100/layer-package-map.json'
const SEAMS_PATH = 'architecture.layers.json'
const PACKAGE_MANIFEST_GLOB = 'packages/*/*/package.json'
const APP_MANIFEST_GLOB = 'apps/*/package.json'
const SOURCE_GLOB = 'src/**/*.{ts,tsx,mts,cts}'
const TSCONFIG_BASE = 'tsconfig.base.json'
const VENDOR_MANIFEST_GLOB = 'vendor/*/package.json'

/** The vendored runtime binding a `kernel`-layer package may import (layering.md rule 4). */
const KERNEL_PERMITTED_CORDIS_BINDINGS = new Set(['Context'])

/**
 * The one position outside the six-layer ranking (layering.md rule 1): an
 * assembly that composes the surfaces and everything beneath them into a
 * runnable profile or entry binary. It may depend on any layer, and no layer
 * may depend on it. It is deliberately not a seventh `PackageLayer` member,
 * so P0-04's frozen Contract-stage layer sequence is unchanged: the position
 * is resolved here, before any edge reaches `classifyEdge`.
 */
const COMPOSITION_ROOT = 'composition-root'

/**
 * The `packages/client/` group spans four layers, so it is resolved by a rule
 * rather than by a per-package table: every `ui-*` directory is a user-facing
 * presentation surface, and the six non-`ui-*` members are named below. A rule
 * is used deliberately in preference to 38 individual picks, which would be
 * far harder to audit for entries chosen to suit a result.
 *
 * `client/web` is deliberately NOT a composition root, and copying it as one
 * would be the wrong pattern: it is the web client's boot kernel (static
 * module table, Cordis loader), and a boot kernel is a thing that gets
 * assembled, not the assembler. The web client's actual composition root is
 * `packages/bundle/web-app`.
 */
const CLIENT_LAYERS = {
  connection: 'providers',
  store: 'capability-definitions',
  locale: 'capability-definitions',
  hmr: 'orchestration-runtime',
  modules: 'orchestration-runtime',
  web: 'orchestration-runtime',
}
const CORDIS_PACKAGE = '@deepseek-ai/cordis'

/**
 * Fallback layer for a `packages/<group>/` directory, used only for a package
 * `architecture.layers.json` names in no layer-bearing capability-family
 * role. Because that document already assigns every family's Definition and
 * Providers, what a capability-family group has left over is its Consumer
 * tier — the model-facing `dsh-tool-*`/`dsh-command-*` plugins that wire a
 * capability in at runtime — which is why those groups map to
 * `orchestration-runtime` here even though the group as a whole spans
 * several layers. Group roles are `packages/README.md`'s own table. A group
 * absent here leaves its packages unclassified, which is itself a violation
 * rather than a silent default (the epic gate's "All packages classified").
 */
const GROUP_LAYERS = {
  kernel: 'kernel',
  util: 'protocol-types',
  typert: 'protocol-types',
  schema: 'protocol-types',
  sdk: 'protocol-types',
  identity: 'protocol-types',
  workspace: 'capability-definitions',
  session: 'capability-definitions',
  'session-query': 'capability-definitions',
  storage: 'capability-definitions',
  memory: 'capability-definitions',
  policy: 'capability-definitions',
  sandbox: 'capability-definitions',
  subprocess: 'capability-definitions',
  context: 'capability-definitions',
  action: 'capability-definitions',
  migration: 'capability-definitions',
  attachment: 'capability-definitions',
  e2b: 'providers',
  core: 'orchestration-runtime',
  run: 'orchestration-runtime',
  boot: 'orchestration-runtime',
  preset: 'orchestration-runtime',
  bundle: COMPOSITION_ROOT,
  plugin: 'orchestration-runtime',
  extensions: 'orchestration-runtime',
  guard: 'orchestration-runtime',
  assurance: 'orchestration-runtime',
  experimental: 'orchestration-runtime',
  'runtime-diagnostics': 'orchestration-runtime',
  'test-support': 'orchestration-runtime',
  compaction: 'orchestration-runtime',
  feedback: 'orchestration-runtime',
  fs: 'orchestration-runtime',
  goal: 'orchestration-runtime',
  hooks: 'orchestration-runtime',
  interaction: 'orchestration-runtime',
  jobs: 'orchestration-runtime',
  llm: 'orchestration-runtime',
  lsp: 'orchestration-runtime',
  mcp: 'orchestration-runtime',
  plan: 'orchestration-runtime',
  schedule: 'orchestration-runtime',
  shell: 'orchestration-runtime',
  skill: 'orchestration-runtime',
  spill: 'orchestration-runtime',
  subagent: 'orchestration-runtime',
  terminal: 'orchestration-runtime',
  todo: 'orchestration-runtime',
  web: 'orchestration-runtime',
  webhook: 'orchestration-runtime',
  workflow: 'orchestration-runtime',
  'code-runtime': 'orchestration-runtime',
  api: 'surfaces-apps',
  host: 'surfaces-apps',
  client: 'surfaces-apps',
  acp: 'surfaces-apps',
}

function normalizePath(path) {
  return path.split(sep).join('/')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readJsonIfPresent(path) {
  return existsSync(path) ? readJson(path) : undefined
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read and validate the layer exemption store (layering.md rules 5 and 6).
 * Missing entries are not an error: an absent store means no exemption is
 * claimed. A malformed one is, so the gate fails closed rather than reading
 * an unsafe shape.
 * @param root - repository (or fixture) root.
 * @returns the declared cycle exemptions, the kernel-edge allowlist, and any shape errors.
 */
export function readLayerExemptions(root) {
  const document = readJsonIfPresent(resolve(root, EXEMPTIONS_PATH))
  const errors = []
  if (document === undefined) return { exemptedCycles: [], kernelEdgeAllowlist: [], errors }
  if (!isPlainObject(document)) {
    return { exemptedCycles: [], kernelEdgeAllowlist: [], errors: [`${EXEMPTIONS_PATH}: not a JSON object`] }
  }

  const exemptedCycles = []
  const rawCycles = document.exemptedCycles
  if (rawCycles !== undefined && !Array.isArray(rawCycles)) errors.push(`${EXEMPTIONS_PATH}: exemptedCycles must be an array`)
  else {
    for (const [index, entry] of (rawCycles ?? []).entries()) {
      if (!isPlainObject(entry) || !Array.isArray(entry.cycle)) {
        errors.push(`${EXEMPTIONS_PATH}: exemptedCycles[${index}] must be an object with a cycle array`)
        continue
      }
      const shapeErrors = validateExemptedCycle({
        cycle: entry.cycle,
        reason: typeof entry.reason === 'string' ? entry.reason : '',
        owner: typeof entry.owner === 'string' ? entry.owner : '',
        adrNote: typeof entry.adrNote === 'string' ? entry.adrNote : '',
        recordedDate: typeof entry.recordedDate === 'string' ? entry.recordedDate : '',
      })
      for (const shapeError of shapeErrors) errors.push(`${EXEMPTIONS_PATH}: exemptedCycles[${index}] ${shapeError}`)
      if (shapeErrors.length === 0) exemptedCycles.push(entry)
    }
  }

  const kernelEdgeAllowlist = []
  const rawAllowlist = document.kernelEdgeAllowlist
  if (rawAllowlist !== undefined && !Array.isArray(rawAllowlist)) {
    errors.push(`${EXEMPTIONS_PATH}: kernelEdgeAllowlist must be an array`)
  } else {
    for (const [index, entry] of (rawAllowlist ?? []).entries()) {
      if (!isPlainObject(entry)) {
        errors.push(`${EXEMPTIONS_PATH}: kernelEdgeAllowlist[${index}] must be an object`)
        continue
      }
      const missing = ['fromPackage', 'toPackage', 'owner', 'reason', 'expires']
        .filter(field => typeof entry[field] !== 'string' || entry[field] === '')
      if (missing.length > 0) {
        errors.push(`${EXEMPTIONS_PATH}: kernelEdgeAllowlist[${index}] missing ${missing.join(', ')}`)
        continue
      }
      if (!ISO_DATE.test(entry.expires) || Number.isNaN(Date.parse(entry.expires))) {
        errors.push(`${EXEMPTIONS_PATH}: kernelEdgeAllowlist[${index}] expires must be an ISO calendar date (YYYY-MM-DD)`)
        continue
      }
      kernelEdgeAllowlist.push(entry)
    }
  }
  return { exemptedCycles, kernelEdgeAllowlist, errors }
}

/**
 * Read every real workspace package and top-level application manifest.
 * @param root - repository (or fixture) root.
 * @returns npm package name -> { dir, manifest }.
 */
function readWorkspaceManifests(root) {
  const byName = new Map()
  const globs = [PACKAGE_MANIFEST_GLOB, APP_MANIFEST_GLOB]
  for (const pattern of globs) {
    for (const manifestPath of globSync(pattern, { cwd: root }).map(normalizePath).sort()) {
      const manifest = readJson(resolve(root, manifestPath))
      if (typeof manifest.name === 'string') byName.set(manifest.name, { dir: dirname(manifestPath), manifest })
    }
  }
  return byName
}

/**
 * Assign every real workspace package a layer (the epic gate's "All packages
 * classified"). `architecture.layers.json`'s capability-family roles decide
 * first, because a family's Service Definition and its providers live in the
 * same `packages/<group>/` directory and a group name alone cannot tell them
 * apart. A `tests/first100/layer-package-map.json` entry outranks every
 * other rule, because a `packages/<group>/` directory can span several
 * layers and no group rule can separate them; `definition` outranks
 * `providers`, since a package that defines a
 * seam sits at that seam's layer whatever else it also implements. The
 * `consumers` role is deliberately NOT layer-bearing: consuming a capability
 * says a package sits somewhere above that capability, not which layer it
 * occupies, and treating it as a layer demotes every UI package that happens
 * to consume a seam out of `surfaces-apps`. {@link GROUP_LAYERS} decides for
 * a package no family names in a layer-bearing role.
 * @param root - repository (or fixture) root.
 * @returns the layer of each package, and the names of any package no rule classified.
 */
export function classifyWorkspacePackages(root) {
  const manifests = readWorkspaceManifests(root)
  const seams = readJsonIfPresent(resolve(root, SEAMS_PATH))
  const definitions = new Set()
  const providers = new Set()
  for (const family of Array.isArray(seams?.families) ? seams.families : []) {
    if (typeof family?.definition === 'string') definitions.add(family.definition)
    for (const provider of Array.isArray(family?.providers) ? family.providers : []) providers.add(provider)
  }

  const overrides = readJsonIfPresent(resolve(root, PACKAGE_MAP_PATH))?.packages ?? {}

  const byPackage = new Map()
  const unclassified = []
  for (const [name, { dir, manifest }] of manifests) {
    const segments = dir.split('/')
    const group = segments[0] === 'apps' ? 'apps' : segments[1]
    let layer
    let source
    if (Object.hasOwn(overrides, name)) {
      layer = overrides[name].layer
      source = PACKAGE_MAP_PATH
    } else if (segments[0] === 'packages' && group === 'kernel') {
      layer = 'kernel'
      source = 'packages/kernel'
    } else if (segments[0] === 'apps') {
      layer = COMPOSITION_ROOT
      source = 'apps'
    } else if (segments[0] === 'packages' && group === 'client') {
      // The signed client-group rule outranks a capability-family role: a
      // `ui-*` package that also defines or provides a seam is still a
      // presentation surface.
      layer = segments[2].startsWith('ui-') ? 'surfaces-apps' : CLIENT_LAYERS[segments[2]]
      source = `packages/client rule`
    } else if (definitions.has(name)) {
      layer = 'capability-definitions'
      source = `${SEAMS_PATH}#definition`
    } else if (providers.has(name)) {
      layer = 'providers'
      source = `${SEAMS_PATH}#providers`
    } else if (Object.hasOwn(GROUP_LAYERS, group)) {
      layer = GROUP_LAYERS[group]
      source = `packages/${group}`
    }
    if (layer === undefined) {
      unclassified.push(name)
      continue
    }
    byPackage.set(name, { layer, source, dir, manifest })
  }
  return { byPackage, unclassified }
}

/**
 * Read the repository's TypeScript path aliases.
 * @param root - repository (or fixture) root.
 * @returns the set of aliased module specifiers.
 */
function readPathAliases(root) {
  const path = resolve(root, TSCONFIG_BASE)
  if (!existsSync(path)) return new Set()
  // tsconfig.base.json carries comments, so it is JSONC and JSON.parse rejects it.
  const config = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8')).config
  const paths = config?.compilerOptions?.paths
  return new Set(isPlainObject(paths) ? Object.keys(paths) : [])
}

/**
 * Every vendored package name, which sits outside the six-layer graph.
 * @param root - repository (or fixture) root.
 * @returns the vendored npm package names.
 */
function readVendoredPackages(root) {
  const names = new Set([CORDIS_PACKAGE])
  for (const manifestPath of globSync(VENDOR_MANIFEST_GLOB, { cwd: root })) {
    const manifest = readJson(resolve(root, manifestPath))
    if (typeof manifest.name === 'string') names.add(manifest.name)
  }
  return names
}

/**
 * Collect the module specifiers a source file imports, separating a static
 * import or re-export from a dynamic `import()`/`require()` call, and
 * recording whether the import was type-only.
 * @param text - the file's source text.
 * @returns static and dynamic specifier sets, plus the type-only specifiers.
 */
function collectSpecifiers(text) {
  const preprocessed = ts.preProcessFile(text, true, true)
  const all = preprocessed.importedFiles.map(file => file.fileName)
  const dynamic = new Set()
  for (const match of text.matchAll(/(?:\bimport|\brequire)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) dynamic.add(match[1])
  const typeOnly = new Set()
  for (const match of text.matchAll(/\bimport\s+type\s[^'"]*['"]([^'"]+)['"]/g)) typeOnly.add(match[1])
  const stat = new Set(all.filter(specifier => !dynamic.has(specifier)))
  return { static: stat, dynamic, typeOnly }
}

/**
 * List a package's source files.
 * @param root - repository (or fixture) root.
 * @param dir - repo-relative package directory.
 * @returns repo-relative source file paths.
 */
function sourceFiles(root, dir) {
  return globSync(SOURCE_GLOB, { cwd: resolve(root, dir) }).map(file => `${dir}/${normalizePath(file)}`)
}

/**
 * Resolve one specifier to the workspace package it names, if any.
 * @param specifier - the imported module specifier.
 * @param byPackage - the classified workspace packages.
 * @returns the package name, or undefined.
 */
function specifierPackage(specifier, byPackage) {
  if (byPackage.has(specifier)) return specifier
  const scoped = specifier.match(/^(@[^/]+\/[^/]+)\//)
  if (scoped && byPackage.has(scoped[1])) return scoped[1]
  return undefined
}

/**
 * Resolve every dependency edge between workspace packages through must[2]'s
 * three detection channels: the declared `dependencies`/`peerDependencies`
 * graph, a TypeScript path-alias import, and a dynamic `import()`/`require()`
 * call. `devDependencies` are excluded, because acceptance[0] scopes cycles
 * to the production graph; including them produces a real test-only cycle
 * that says nothing about the shipped dependency structure.
 * @param root - repository (or fixture) root.
 * @param byPackage - the classified workspace packages.
 * @returns one resolved edge per distinct package pair, carrying the channel that found it.
 */
export function collectLayerEdges(root, byPackage) {
  const aliases = readPathAliases(root)
  const edges = new Map()
  const record = (fromPackage, toPackage, detectionMethod, nature) => {
    const key = `${fromPackage} ${toPackage}`
    if (edges.has(key)) return
    const from = byPackage.get(fromPackage)
    const to = byPackage.get(toPackage)
    edges.set(key, {
      fromPackage,
      fromLayer: from.layer,
      toPackage,
      toLayer: to?.layer,
      detectionMethod,
      nature,
    })
  }

  for (const [name, { manifest }] of byPackage) {
    for (const field of ['dependencies', 'peerDependencies']) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        if (dependency !== name && byPackage.has(dependency)) record(name, dependency, 'package-graph', 'value')
      }
    }
  }

  for (const [name, { dir }] of byPackage) {
    for (const file of sourceFiles(root, dir)) {
      const { static: stat, dynamic, typeOnly } = collectSpecifiers(readFileSync(resolve(root, file), 'utf8'))
      for (const specifier of stat) {
        const target = specifierPackage(specifier, byPackage)
        if (target === undefined || target === name) continue
        const nature = typeOnly.has(specifier) && /EventMap/.test(specifier) ? 'event-type-only' : 'value'
        record(name, target, aliases.has(specifier) ? 'path-alias' : 'package-graph', nature)
      }
      for (const specifier of dynamic) {
        const target = specifierPackage(specifier, byPackage)
        if (target === undefined || target === name) continue
        record(name, target, 'dynamic-require', 'value')
      }
    }
  }
  return [...edges.values()]
}

/**
 * Resolve a `kernel`-layer package's edges to the vendored runtime at binding
 * granularity (layering.md rule 4). Only a kernel package's own sources are
 * fully parsed, so the precise binding names rule 4 needs cost one small
 * TypeScript parse rather than a repo-wide one.
 * @param root - repository (or fixture) root.
 * @param byPackage - the classified workspace packages.
 * @returns one entry per kernel package/vendored package pair, with its imported bindings.
 */
function collectKernelVendorEdges(root, byPackage) {
  const vendored = readVendoredPackages(root)
  const found = new Map()
  for (const [name, { layer, dir }] of byPackage) {
    if (layer !== 'kernel') continue
    for (const file of sourceFiles(root, dir)) {
      const text = readFileSync(resolve(root, file), 'utf8')
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
      for (const statement of source.statements) {
        const isImport = ts.isImportDeclaration(statement)
        const isExport = ts.isExportDeclaration(statement)
        if (!isImport && !isExport) continue
        const moduleSpecifier = statement.moduleSpecifier
        if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) continue
        const specifier = moduleSpecifier.text
        const target = [...vendored].find(pkg => specifier === pkg || specifier.startsWith(`${pkg}/`))
        if (target === undefined) continue
        const key = `${name} ${target}`
        const entry = found.get(key) ?? { fromPackage: name, toPackage: target, bindingFiles: new Map(), files: new Set() }
        entry.files.add(file)
        const addBinding = binding => {
          const files = entry.bindingFiles.get(binding) ?? new Set()
          files.add(file)
          entry.bindingFiles.set(binding, files)
        }
        const clause = isImport ? statement.importClause : statement.exportClause
        if (isImport && clause?.name !== undefined) addBinding('default')
        const bindings = isImport ? clause?.namedBindings : clause
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) addBinding((element.propertyName ?? element.name).text)
        } else if (bindings !== undefined && ts.isNamespaceImport(bindings)) addBinding('*')
        else if (bindings !== undefined && ts.isNamedExports(bindings)) {
          for (const element of bindings.elements) addBinding((element.propertyName ?? element.name).text)
        }
        found.set(key, entry)
      }
    }
  }
  return [...found.values()].map(entry => ({
    fromPackage: entry.fromPackage,
    toPackage: entry.toPackage,
    bindings: [...entry.bindingFiles.keys()].sort(),
    bindingFiles: entry.bindingFiles,
    files: [...entry.files].sort(),
  }))
}

/**
 * Drop the per-binding file index, which exists only so a forbidden-binding
 * violation can name the files that actually contain the forbidden import.
 * @param entry - one kernel/vendored package edge.
 * @returns the edge without its `bindingFiles` index.
 */
function withoutBindingFiles({ bindingFiles, ...entry }) {
  return entry
}

/**
 * Run the full layer-dependency gate against a real repository or fixture root.
 * @param root - repository (or fixture) root.
 * @returns violations, the shortest unexempted cycle, unclassified packages, kernel edges, and scan counts.
 */
export function runLayerDepsCheck(root) {
  const { byPackage, unclassified } = classifyWorkspacePackages(root)
  const exemptions = readLayerExemptions(root)
  const violations = []
  for (const error of exemptions.errors) violations.push({ rule: 'malformed-exemption-store', fromPackage: '', toPackage: '', detail: error })
  for (const name of unclassified) {
    violations.push({ rule: 'unclassified-package', fromPackage: name, toPackage: '', detail: `${name} matched no capability-family role and no packages/<group> entry` })
  }

  const edges = collectLayerEdges(root, byPackage)
  const allowed = new Map(exemptions.kernelEdgeAllowlist.map(entry => [`${entry.fromPackage} ${entry.toPackage}`, entry]))
  const usedAllowances = new Set()
  const today = new Date().toISOString().slice(0, 10)

  const kernelEdges = []
  for (const entry of collectKernelVendorEdges(root, byPackage)) {
    const forbidden = entry.toPackage === CORDIS_PACKAGE
      ? entry.bindings.filter(binding => !KERNEL_PERMITTED_CORDIS_BINDINGS.has(binding))
      : entry.bindings
    if (forbidden.length === 0) {
      kernelEdges.push({ ...withoutBindingFiles(entry), verdict: 'permitted-binding' })
      continue
    }
    const key = `${entry.fromPackage} ${entry.toPackage}`
    const allowance = allowed.get(key)
    if (allowance !== undefined && allowance.expires >= today) {
      usedAllowances.add(key)
      kernelEdges.push({ ...withoutBindingFiles(entry), verdict: 'allowlisted' })
      continue
    }
    if (allowance !== undefined) usedAllowances.add(key)
    kernelEdges.push({ ...withoutBindingFiles(entry), verdict: 'violation' })
    const forbiddenFiles = [...new Set(forbidden.flatMap(binding => [...entry.bindingFiles.get(binding) ?? []]))].sort()
    violations.push({
      rule: 'kernel-forbidden-cordis-binding',
      fromPackage: entry.fromPackage,
      toPackage: entry.toPackage,
      detail: `imports ${forbidden.join(', ')} from ${entry.toPackage} (rule 4 permits only ${[...KERNEL_PERMITTED_CORDIS_BINDINGS].join(', ')}) in ${forbiddenFiles.join(', ')}`,
    })
  }

  for (const edge of edges) {
    // layering.md rule 1: a composition root may depend on any layer, so its
    // own outgoing edges are unranked and never reach classifyEdge.
    if (edge.fromLayer === COMPOSITION_ROOT) continue
    // The half that makes the position a rule rather than an exemption: no
    // layer may depend on a composition root.
    if (edge.toLayer === COMPOSITION_ROOT) {
      violations.push({
        rule: 'composition-root-inbound-dependency',
        fromPackage: edge.fromPackage,
        toPackage: edge.toPackage,
        detail: `${edge.fromLayer} -> composition root via ${edge.detectionMethod}; nothing may depend on a composition root (layering.md rule 1)`,
      })
      continue
    }
    const verdict = classifyEdge(edge)
    if (verdict === 'ok' || verdict === 'narrow-event-type-allowed') continue
    const key = `${edge.fromPackage} ${edge.toPackage}`
    const allowance = edge.fromLayer === 'kernel' ? allowed.get(key) : undefined
    if (allowance !== undefined) {
      usedAllowances.add(key)
      if (allowance.expires >= today) {
        kernelEdges.push({ fromPackage: edge.fromPackage, toPackage: edge.toPackage, bindings: [], files: [], verdict: 'allowlisted' })
        continue
      }
    }
    violations.push({
      rule: edge.fromLayer === 'kernel' ? 'kernel-upward-dependency' : verdict === 'global-singleton-violation' ? 'global-singleton' : 'layer-violation',
      fromPackage: edge.fromPackage,
      toPackage: edge.toPackage,
      detail: `${edge.fromLayer} -> ${edge.toLayer ?? 'outside the six-layer graph'} via ${edge.detectionMethod}`,
    })
  }

  for (const entry of exemptions.kernelEdgeAllowlist) {
    const key = `${entry.fromPackage} ${entry.toPackage}`
    if (!usedAllowances.has(key)) {
      violations.push({
        rule: 'stale-kernel-edge-allowlist',
        fromPackage: entry.fromPackage,
        toPackage: entry.toPackage,
        detail: 'allowlist entry names an edge that no longer exists — remove it (layering.md rule 6)',
      })
      continue
    }
    if (entry.expires < today) {
      violations.push({
        rule: 'expired-kernel-edge-allowlist',
        fromPackage: entry.fromPackage,
        toPackage: entry.toPackage,
        detail: `allowlist entry expired ${entry.expires} (owner ${entry.owner}) — remove the edge or re-justify it (layering.md rule 6)`,
      })
    }
  }

  const productionEdges = edges.filter(edge => edge.detectionMethod === 'package-graph')
  const cycle = findShortestCycle(productionEdges, exemptions.exemptedCycles)
  const shortestCycle = cycle.shortestCycle
  if (shortestCycle !== undefined && !cycle.isExempted) {
    violations.push({
      rule: 'unexempted-cycle',
      fromPackage: shortestCycle[0],
      toPackage: shortestCycle[shortestCycle.length - 1],
      detail: `shortest cycle: ${shortestCycle.join(' -> ')} -> ${shortestCycle[0]}`,
    })
  }

  return {
    violations,
    shortestCycle: cycle.isExempted ? undefined : shortestCycle,
    unclassified,
    kernelEdges,
    scanned: { packages: byPackage.size, edges: edges.length, layers: LAYER_ORDER.length },
  }
}

function main(argv) {
  const rootFlag = argv.indexOf('--repo-root')
  const root = rootFlag === -1 ? resolve(import.meta.dirname, '../..') : resolve(argv[rootFlag + 1])
  const started = Date.now()
  const result = runLayerDepsCheck(root)
  const elapsed = ((Date.now() - started) / 1000).toFixed(2)
  for (const violation of result.violations) {
    process.stderr.write(`${GATE}: ${violation.rule}: ${violation.fromPackage} -> ${violation.toPackage}: ${violation.detail}\n`)
  }
  const summary = `${GATE}: ${result.violations.length} violation(s) across ${result.scanned.packages} classified package(s), ${result.scanned.edges} dependency edge(s), ${LAYER_ORDER.length} layers + composition roots, in ${elapsed}s.\n`
  process.stdout.write(summary)
  return result.violations.length === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2))
}
