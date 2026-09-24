/**
 * Real layer-dependency architecture gate (Epic P0-04, U-stage): classifies
 * every package `pnpm-workspace.yaml` declares into `./layer-order.ts`'s
 * six-layer sequence (a vendored package takes no layer), resolves
 * dependency edges through must[2]'s three detection channels, enforces
 * `docs/architecture/layering.md`'s rules 1-6 against the resolved facts,
 * and reports every unexempted cycle in the real production package graph,
 * vendored packages included. Plain ESM (not TypeScript) so it runs the same
 * way as every other tsx-launched gate script while importing the `.ts`
 * contract module directly — see `docs/development.md#typescript-project-layout`
 * on source-plane gates, and `./check-capability-seams.mjs` (Epic P0-03) for
 * the same script shape.
 *
 * Run: `pnpm run architecture:layers` (`tsx scripts/architecture/check-layer-deps.mjs
 * [--repo-root <path>] [--budget-ms <n>]`). `--repo-root` defaults to this
 * script's own repository root (not `process.cwd()`) and exists for the
 * fixture-driven tests in `tests/architecture/check-layer-deps.spec.ts`.
 * `--budget-ms` replaces acceptance[2]'s 10-second budget; the run exits
 * non-zero when it takes longer than the budget.
 *
 * The exemption store this reads is `tests/first100/layer-cycle-exemptions.json`
 * (path patch `P0-04-U-cycle-exemptions`; the root `architecture.layers.json`
 * is P0-03's exclusively owned file). This script never writes it, so the
 * gate cannot widen its own escape hatch.
 */

import { readFileSync, writeFileSync, globSync, existsSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, resolve, sep } from 'node:path'
import { load as parseYaml } from 'js-yaml'
import ts from 'typescript'
import { LAYER_ORDER, classifyEdge, validateExemptedCycle } from './layer-order.ts'

const GATE = 'check-layer-deps'
const EXEMPTIONS_PATH = 'tests/first100/layer-cycle-exemptions.json'
const PACKAGE_MAP_PATH = 'tests/first100/layer-package-map.json'
/** The persistent findings report, in P0-04's own canonical directory so the observations outlive a CI log. */
const FINDINGS_PATH = 'scripts/architecture/layer-findings.md'
const SEAMS_PATH = 'architecture.layers.json'
/** The workspace file whose `packages:` patterns decide which packages this gate scans. */
const WORKSPACE_PATH = 'pnpm-workspace.yaml'
const SOURCE_GLOB = 'src/**/*.{ts,tsx,mts,cts}'
const TSCONFIG_BASE = 'tsconfig.base.json'
/** acceptance[2]: one complete run, measured from process start, finishes within this budget. */
const TIME_BUDGET_MS = 10_000
/** The manifest fields that make up the production package graph; `devDependencies` are outside it. */
const PRODUCTION_DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies']
/** A kernel package's direct dependencies: acceptance[1] counts every field a consumer installs. */
const KERNEL_DEPENDENCY_FIELDS = [...PRODUCTION_DEPENDENCY_FIELDS, 'optionalDependencies']

/**
 * A module-level mutable exported binding: the "module-level singleton" half
 * of layering.md rule 3. `export const` is not one — an immutable binding
 * carries no state another package can reach through.
 */
const MUTABLE_EXPORT = /^[\t ]*export\s+(?:let|var)\s+([A-Za-z_$][\w$]*)/gm
/** An assignment to a shared global: the "shared mutable global" half of rule 3. */
const GLOBAL_WRITE = /\b(?:globalThis|window|global)\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g
/** Any read of a shared global key, paired against {@link GLOBAL_WRITE} to find a hidden cross-package channel. */
const GLOBAL_READ = /\b(?:globalThis|window|global)\s*\.\s*([A-Za-z_$][\w$]*)/g
/** Named import bindings, so a mutable export can be matched to the packages that import it. */
const NAMED_IMPORT = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g

/**
 * The one use of the vendored runtime rule 4 permits, and only to
 * {@link TRUST_KERNEL_PACKAGE} (layering.md rule 4): the `Context` import
 * binding, which a declare-module augmentation of the `Context` interface
 * also records.
 */
const KERNEL_PERMITTED_CORDIS_BINDINGS = new Set(['Context'])

/**
 * The one package acceptance[1], as narrowed on 2026-09-24, admits the Cordis
 * uses to. Any other `kernel`-layer package may not use the vendored runtime.
 */
const TRUST_KERNEL_PACKAGE = '@deepseek-ai/dsh-trust-kernel'

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
 * `packages/client/**` is one horizontal band, not a vertical stack, so the
 * whole group is `surfaces-apps` including its six non-`ui-*` members.
 *
 * WITHDRAWN RULE, recorded verbatim at the signer's request: "The signer
 * attempted to layer `client/` by self-described role (2026-09-04); the
 * measurement returned a net +12 upward edges. A self-description covers half
 * of what these packages are. The group is one horizontal layer, not a
 * vertical stack. This conclusion was produced by measurement, not chosen by
 * the classifier."
 *
 * The three counterexamples the measurement produced: `client/locale` calls
 * itself an extensible catalogue yet depends on four `ui-*` packages;
 * `client/connection` calls itself an RPC transport yet depends on
 * `dsh-host-webserver` and `dsh-tool-todo`; `client/web` calls itself a boot
 * kernel yet depends on `ui-primitives`/`ui-renderer`/`ui-slots`, and
 * something that assembles UI cannot sit beneath it. `client/web` is still
 * not a composition root -- a boot kernel is a thing that gets assembled, and
 * the web client's composition root is `packages/bundle/web-app`.
 */
const CLIENT_LAYER = 'surfaces-apps'

/**
 * `packages/test-support/**` is excluded from the ranked production
 * dependency graph, declared here rather than left as a convenient default.
 *
 * The exclusion criterion, stated in full: a package under
 * `packages/test-support/` exists to assemble the thing under test, so it
 * must be able to depend on any layer; and no production package depends on
 * it. That is the same reasoning `COMPOSITION_ROOT` rests on, and it carries
 * the same second half -- {@link runLayerDepsCheck} enforces that any ranked
 * package depending on `test-support/**` is a violation. An exclusion without
 * that reverse constraint would cancel a constraint rather than add one.
 */
const TEST_SUPPORT = 'test-support'

/** The two positions outside the six-layer ranking: each may depend on any layer, and no ranked layer may depend on either. Each carries the rule it is reported under and the `layering.md` rule that defines it. */
const UNRANKED_POSITIONS = new Map([
  [COMPOSITION_ROOT, { rule: 'composition-root-inbound-dependency', label: 'a composition root', reference: 'layering.md rule 1' }],
  [TEST_SUPPORT, { rule: 'test-support-inbound-dependency', label: 'a test-support package', reference: 'layering.md rule 6' }],
])
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
  // The credentials family's own Definition and Provider are named in
  // `architecture.layers.json` and take their layer from there. What the group
  // has left over is P3-06's `secrets-broker`: the secret-lease vocabulary and
  // its state machine, pure decisions over caller-supplied records with
  // type-only dependencies and no provider -- the capability-definition role,
  // not the Consumer tier this table's default would assume.
  credentials: 'capability-definitions',
  // P3-01's ExecutionWorld seam: the nine-dimension spec, the unforgeable
  // handle, the OCI-adapted lifecycle and the fail-closed provider
  // selection. Types and pure decisions over caller-supplied values,
  // depending only on `dsh-brand` and `dsh-principal`, shipping no provider
  // -- the capability-definition role, beside `sandbox`, which confines
  // commands in the one world this harness has today.
  execution: 'capability-definitions',
  subprocess: 'capability-definitions',
  context: 'capability-definitions',
  action: 'capability-definitions',
  migration: 'capability-definitions',
  attachment: 'capability-definitions',
  // P5-11's coordination primitives (taskboard, mailbox, blackboard) and
  // P4-06's `intake-dedup`: pure decision functions over caller-supplied
  // state, depending only on `dsh-brand` and on each other. They define what a
  // claim, a delivery, a fact and a duplicate ARE and ship no provider, which
  // is the capability-definition role. `intake-dedup` is here rather than
  // beside its bus because a definition may not depend on a runtime, which is
  // what a mailbox importing `dsh-message-bus` would have been (BLOCKED-136).
  collaboration: 'capability-definitions',
  // P4-11's retry decisions: the failure taxonomy read against the action
  // ledger's state, the run-wide budget's accounting, and the hedge rule. Pure
  // functions over caller-supplied facts that define what "retryable" and
  // "spent" ARE, with the circuit breaker adopted from `cockatiel` in the
  // Provider stage and backoff left to `llm-retry`. A definition may not
  // depend on a runtime, which is why the delay arrives already computed.
  reliability: 'capability-definitions',
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
  'test-support': TEST_SUPPORT,
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
 * an unsafe shape. A well-shaped cycle record whose `adrNote` names no file,
 * or that names the same cycle as an earlier record, is an error but still
 * exempts its cycle, so the store's defect is reported once.
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
      if (shapeErrors.length > 0) continue
      if (!existsSync(resolve(root, entry.adrNote))) errors.push(`${EXEMPTIONS_PATH}: exemptedCycles[${index}] adrNote ${entry.adrNote} names no file`)
      const cycleKey = rotateToSmallest(entry.cycle).join('\0')
      if (exemptedCycles.some(earlier => rotateToSmallest(earlier.cycle).join('\0') === cycleKey)) {
        errors.push(`${EXEMPTIONS_PATH}: exemptedCycles[${index}] names the same cycle as an earlier record`)
      }
      exemptedCycles.push(entry)
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
 * Read the manifest of every package `pnpm-workspace.yaml`'s `packages:`
 * patterns declare. A workspace file that declares no pattern throws, so the
 * gate can never pass by scanning nothing.
 * @param root - repository (or fixture) root.
 * @returns npm package name -> { dir, manifest }.
 */
function readWorkspaceManifests(root) {
  const patterns = parseYaml(readFileSync(resolve(root, WORKSPACE_PATH), 'utf8'))?.packages
  if (!Array.isArray(patterns) || patterns.length === 0) throw new Error(`${GATE}: ${WORKSPACE_PATH} declares no packages`)
  const byName = new Map()
  for (const pattern of patterns) {
    for (const manifestPath of globSync(`${pattern}/package.json`, { cwd: root }).map(normalizePath).sort()) {
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
 * a package no family names in a layer-bearing role. A package under
 * `vendor/` takes no layer: it sits outside the six-layer graph and inside
 * the cycle graph (layering.md).
 * @param root - repository (or fixture) root.
 * @returns the layer of each package, the names of any package no rule classified, and the vendored packages.
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
  const vendored = new Map()
  for (const [name, { dir, manifest }] of manifests) {
    const segments = dir.split('/')
    if (segments[0] === 'vendor') {
      vendored.set(name, { dir, manifest })
      continue
    }
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
      layer = CLIENT_LAYER
      source = 'packages/client rule'
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
  return { byPackage, unclassified, vendored }
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
 * Whether a specifier names a package: not a relative or absolute path, not a
 * package-internal `#` import, and not a URL-scheme specifier such as `node:`
 * (the same test `./check-capability-seams.mjs` applies).
 * @param specifier - the module specifier.
 * @returns whether the specifier resolves through a package name.
 */
function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#') && !specifier.includes(':')
}

/**
 * The npm package name a bare specifier resolves to.
 * @param specifier - a bare module specifier.
 * @returns the package name: the first two segments of a scoped specifier, otherwise the first.
 */
function packageNameOf(specifier) {
  return specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
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
  // Records the specifier AND the bindings the type-only import names, because
  // must[1]'s narrow-event-type allowance is decided by WHAT is imported, not
  // by the module path. Testing /EventMap/ against the specifier can never
  // match: no module in this repository is named `*EventMap*`, while 13 files
  // import an `*EventMap` binding, so the allowance was unreachable and a
  // type-only event-map import was classified `value` like any other.
  const typeOnlyBindings = new Map()
  for (const match of text.matchAll(/\bimport\s+type\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    typeOnly.add(match[2])
    const named = typeOnlyBindings.get(match[2]) ?? new Set()
    for (const binding of match[1].replace(/[{}]/g, '').split(',')) {
      const cleaned = binding.trim().split(/\s+as\s+/u)[0]?.trim()
      if (cleaned) named.add(cleaned)
    }
    typeOnlyBindings.set(match[2], named)
  }
  for (const match of text.matchAll(/\bimport\s+type\s[^'"]*['"]([^'"]+)['"]/g)) typeOnly.add(match[1])
  const stat = new Set(all.filter(specifier => !dynamic.has(specifier)))
  return { static: stat, dynamic, typeOnly, typeOnlyBindings }
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
 * Collect one source file's rule-3 facts: the mutable module-level bindings it
 * exports, the shared-global keys it writes and reads, and the named bindings
 * it imports per module specifier.
 * @param text - the file's source text.
 * @returns the file's mutable exports, global writes, global reads, and named imports by specifier.
 */
/**
 * Blank out comments and string/template literal contents, preserving offsets
 * and line structure so every other pattern in this file keeps matching the
 * same way. Quote characters are kept and their contents replaced with spaces,
 * so a specifier scan still sees an empty literal rather than a syntax change.
 * @param text - a source file's text.
 * @returns the same text with comment and literal contents blanked.
 */
function stripNonCode(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const two = text.slice(i, i + 2)
    if (two === '//') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      out += text.slice(i, stop).replace(/[^\n]/gu, ' ')
      i = stop
      continue
    }
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      out += ch
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        if (text[i] === ch) break
        out += text[i] === '\n' ? '\n' : ' '
        i += 1
      }
      if (i < text.length) {
        out += ch
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

function collectStateFacts(text) {
  // Match executable code only. A package that EMITS source text — the web
  // module system returns `<script>` rows for an HTML head, with
  // `window.__ModuleLoader__ = {...}` inside a template literal — writes no
  // global in its own process, and rule 3 forbids *reaching another layer's
  // state*, not containing characters that resemble a write. Scanning raw text
  // reported two such violations that were never violations: the checker's
  // stated verdict ("this package writes a shared global") and what it actually
  // evaluated ("this file's bytes match a write pattern") were different
  // claims.
  const code = stripNonCode(text)
  const mutableExports = new Set()
  for (const match of code.matchAll(MUTABLE_EXPORT)) mutableExports.add(match[1])
  const globalWrites = new Set()
  for (const match of code.matchAll(GLOBAL_WRITE)) globalWrites.add(match[1])
  const globalReads = new Set()
  for (const match of code.matchAll(GLOBAL_READ)) globalReads.add(match[1])
  const namedImports = new Map()
  for (const match of text.matchAll(NAMED_IMPORT)) {
    const bindings = namedImports.get(match[2]) ?? new Set()
    for (const clause of match[1].split(',')) {
      const name = clause.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim()
      if (name !== '') bindings.add(name)
    }
    namedImports.set(match[2], bindings)
  }
  return { mutableExports, globalWrites, globalReads, namedImports }
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
    const key = `${fromPackage} ${toPackage}`
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
    for (const field of PRODUCTION_DEPENDENCY_FIELDS) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        if (dependency !== name && byPackage.has(dependency)) record(name, dependency, 'package-graph', 'value')
      }
    }
  }

  const facts = new Map()
  for (const [name, { dir }] of byPackage) {
    const packageFacts = {
      mutableExports: new Set(),
      globalWrites: new Map(),
      globalReads: new Map(),
      importedBindings: new Map(),
    }
    for (const file of sourceFiles(root, dir)) {
      const text = readFileSync(resolve(root, file), 'utf8')
      const { static: stat, dynamic, typeOnly, typeOnlyBindings } = collectSpecifiers(text)
      const state = collectStateFacts(text)
      for (const binding of state.mutableExports) packageFacts.mutableExports.add(binding)
      for (const key of state.globalWrites) if (!packageFacts.globalWrites.has(key)) packageFacts.globalWrites.set(key, file)
      for (const key of state.globalReads) if (!packageFacts.globalReads.has(key)) packageFacts.globalReads.set(key, file)
      for (const [specifier, bindings] of state.namedImports) {
        const target = specifierPackage(specifier, byPackage)
        if (target === undefined || target === name) continue
        const known = packageFacts.importedBindings.get(target) ?? new Map()
        for (const binding of bindings) if (!known.has(binding)) known.set(binding, file)
        packageFacts.importedBindings.set(target, known)
      }
      for (const specifier of stat) {
        const target = specifierPackage(specifier, byPackage)
        if (target === undefined || target === name) continue
        const eventTypeOnly = typeOnly.has(specifier)
          && [...(typeOnlyBindings.get(specifier) ?? [])].length > 0
          && [...(typeOnlyBindings.get(specifier) ?? [])].every(binding => /EventMap$/u.test(binding))
        const nature = eventTypeOnly ? 'event-type-only' : 'value'
        record(name, target, aliases.has(specifier) ? 'path-alias' : 'package-graph', nature)
      }
      for (const specifier of dynamic) {
        const target = specifierPackage(specifier, byPackage)
        if (target === undefined || target === name) continue
        record(name, target, 'dynamic-require', 'value')
      }
    }
    facts.set(name, packageFacts)
  }

  // layering.md rule 3, first half: an edge that imports another package's
  // mutable module-level binding reaches that package's state directly. The
  // nature upgrade is what finally hands `classifyEdge` a 'global-singleton'
  // edge -- the Contract stage defined that verdict and nothing produced it
  // until this pass existed.
  const singletonBindings = new Map()
  for (const edge of edges.values()) {
    const imported = facts.get(edge.fromPackage)?.importedBindings.get(edge.toPackage)
    const mutable = facts.get(edge.toPackage)?.mutableExports
    if (imported === undefined || mutable === undefined) continue
    const reached = [...imported.keys()].filter(binding => mutable.has(binding)).sort()
    if (reached.length === 0) continue
    edge.nature = 'global-singleton'
    singletonBindings.set(`${edge.fromPackage} ${edge.toPackage}`, reached.map(binding => `${binding} (${imported.get(binding)})`))
  }

  return { edges: [...edges.values()], facts, singletonBindings }
}

/**
 * Resolve a `kernel`-layer package's direct dependencies on packages outside
 * the ranked workspace graph -- the vendored runtime and any external
 * package -- at the granularity rule 4 needs (layering.md). A dependency is
 * found in the package's manifest or in any module reference its sources
 * make, and each use carries one label:
 * - an import declaration: each binding's name (`Context`, `default`), or `*`
 *   for a namespace import or an import that binds nothing;
 * - a re-export declaration: `export <name>`, or `export *` when it names no
 *   binding;
 * - a `declare module '<package>'` block: `Context` for an augmentation of
 *   the `Context` interface, otherwise `declare module <name>` for each
 *   declaration in it;
 * - any other reference TypeScript's dependency scan finds (`import()`,
 *   `require()`, `import x = require()`, an import type, a triple-slash types
 *   reference): `*`;
 * - a manifest declaration: `package.json <field>`, except the
 *   `@deepseek-ai/cordis` peer declaration the package's `Context` use needs.
 * Only a kernel package's own sources are parsed, so this costs one small
 * TypeScript parse rather than a repo-wide one.
 * @param root - repository (or fixture) root.
 * @param byPackage - the classified workspace packages.
 * @param vendoredNames - the vendored package names, `@deepseek-ai/cordis` included.
 * @param workspaceNames - every workspace package name; none of them is an external package.
 * @returns one entry per kernel package/target pair, with its labelled uses and whether the target is external.
 */
function collectKernelNonWorkspaceEdges(root, byPackage, vendoredNames, workspaceNames) {
  const found = new Map()
  for (const [name, { layer, dir, manifest }] of byPackage) {
    if (layer !== 'kernel') continue
    const addUse = (specifier, label, file) => {
      if (!isBareSpecifier(specifier) || isBuiltin(specifier)) return
      const target = packageNameOf(specifier)
      const external = !vendoredNames.has(target)
      if (external && workspaceNames.has(target)) return
      const key = `${name}\0${target}`
      const entry = found.get(key) ?? { fromPackage: name, toPackage: target, external, bindingFiles: new Map(), files: new Set() }
      entry.files.add(file)
      const files = entry.bindingFiles.get(label) ?? new Set()
      files.add(file)
      entry.bindingFiles.set(label, files)
      found.set(key, entry)
    }
    for (const file of sourceFiles(root, dir)) {
      const text = readFileSync(resolve(root, file), 'utf8')
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
      // Start offsets of the specifiers the declarations below account for.
      const declared = new Set()
      for (const statement of source.statements) {
        if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name)) {
          declared.add(statement.name.getStart(source))
          const body = statement.body !== undefined && ts.isModuleBlock(statement.body) ? statement.body.statements : []
          const labels = body.map(declaration => ts.isInterfaceDeclaration(declaration) && declaration.name.text === 'Context'
            ? 'Context'
            : `declare module ${declaration.name?.text ?? '*'}`)
          for (const label of labels.length > 0 ? labels : ['declare module *']) addUse(statement.name.text, label, file)
          continue
        }
        const isImport = ts.isImportDeclaration(statement)
        const isExport = ts.isExportDeclaration(statement)
        if (!isImport && !isExport) continue
        const moduleSpecifier = statement.moduleSpecifier
        if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) continue
        declared.add(moduleSpecifier.getStart(source))
        const labels = []
        const clause = isImport ? statement.importClause : statement.exportClause
        if (isImport && clause?.name !== undefined) labels.push('default')
        const bindings = isImport ? clause?.namedBindings : clause
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) labels.push((element.propertyName ?? element.name).text)
        } else if (bindings !== undefined && ts.isNamespaceImport(bindings)) labels.push('*')
        else if (bindings !== undefined && ts.isNamedExports(bindings)) {
          for (const element of bindings.elements) labels.push(`export ${(element.propertyName ?? element.name).text}`)
        }
        // `import '…'`, `import {} from`, `export * from`, `export * as ns from`
        // and `export {} from` bind no name and still depend on the module.
        if (labels.length === 0) labels.push(isImport ? '*' : 'export *')
        for (const label of labels) addUse(moduleSpecifier.text, label, file)
      }
      const { importedFiles, typeReferenceDirectives } = ts.preProcessFile(text, true, true)
      for (const reference of [...importedFiles, ...typeReferenceDirectives]) {
        if (!declared.has(reference.pos)) addUse(reference.fileName, '*', file)
      }
    }
    for (const field of KERNEL_DEPENDENCY_FIELDS) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        const neededPeer = field === 'peerDependencies' && dependency === CORDIS_PACKAGE
          && found.get(`${name}\0${CORDIS_PACKAGE}`)?.bindingFiles.has('Context') === true
        if (!neededPeer) addUse(dependency, `package.json ${field}`, `${dir}/package.json`)
      }
    }
  }
  return [...found.values()].map(entry => ({
    fromPackage: entry.fromPackage,
    toPackage: entry.toPackage,
    external: entry.external,
    bindings: [...entry.bindingFiles.keys()].sort(),
    bindingFiles: entry.bindingFiles,
    files: [...entry.files].sort(),
  }))
}

/**
 * Drop the per-binding file index, which exists only so a forbidden-binding
 * violation can name the files that actually contain the forbidden import.
 * @param entry - one kernel edge to a vendored or external package.
 * @returns the edge without its `bindingFiles` index.
 */
function withoutBindingFiles({ bindingFiles, ...entry }) {
  return entry
}

/**
 * The production edges that touch a vendored package: a vendored package's
 * dependency on any workspace package, and a classified package's dependency
 * on a vendored one. They join the cycle graph only, because a vendored
 * package takes no layer.
 * @param byPackage - the classified workspace packages.
 * @param vendored - the vendored workspace packages.
 * @returns one edge per declared dependency.
 */
function collectVendoredEdges(byPackage, vendored) {
  const vendoredEdges = []
  for (const [name, { manifest }] of [...byPackage, ...vendored]) {
    for (const field of PRODUCTION_DEPENDENCY_FIELDS) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        const touchesVendored = vendored.has(dependency) || (vendored.has(name) && byPackage.has(dependency))
        if (dependency !== name && touchesVendored) vendoredEdges.push({ fromPackage: name, toPackage: dependency })
      }
    }
  }
  return vendoredEdges
}

/**
 * The edges one exemption record names: each package depends on the next,
 * and the last on the first.
 * @param cycle - the record's packages in edge order.
 * @returns `"<from>\0<to>"` keys.
 */
function recordEdges(cycle) {
  return cycle.map((pkg, index) => `${pkg}\0${cycle[(index + 1) % cycle.length]}`)
}

/**
 * A cycle rotated to begin at its lexicographically smallest package: the one
 * spelling this gate reports a cycle in and matches records by.
 * @param cycle - packages in edge order.
 * @returns the same cycle, rotated.
 */
function rotateToSmallest(cycle) {
  const start = cycle.indexOf([...cycle].sort()[0])
  return [...cycle.slice(start), ...cycle.slice(0, start)]
}

/**
 * Find every unexempted cycle in the production package graph and every
 * exemption record naming an edge the graph lacks (acceptance[0],
 * layering.md rule 5). A record exempts exactly the cycle its edge order
 * names, identified up to rotation, never by its package set. Two searches
 * together reach every unexempted cycle:
 * - through each edge no record names, the shortest cycle containing it -- a
 *   breadth-first search back from the edge's target, O(edges * (packages +
 *   edges)) in total, where enumerating simple cycles grows factorially;
 * - on the subgraph of recorded edges, every simple cycle no record names:
 *   one made of edges that several records name.
 * @param edges - the production graph's edges.
 * @param exemptedCycles - the validated exemption records.
 * @returns the unexempted cycles (each rotated to its smallest package, shortest first, then by package names) and the stale records.
 */
function findUnexemptedCycles(edges, exemptedCycles) {
  const adjacency = new Map()
  const graphEdges = new Set()
  for (const { fromPackage, toPackage } of edges) {
    const key = `${fromPackage}\0${toPackage}`
    if (graphEdges.has(key)) continue
    graphEdges.add(key)
    adjacency.set(fromPackage, [...(adjacency.get(fromPackage) ?? []), toPackage])
  }
  for (const targets of adjacency.values()) targets.sort()
  const recordedEdges = new Set(exemptedCycles.flatMap(entry => recordEdges(entry.cycle)))
  const recordedCycles = new Set(exemptedCycles.map(entry => rotateToSmallest(entry.cycle).join('\0')))
  const found = new Map()
  const report = cycle => {
    const rotated = rotateToSmallest(cycle)
    found.set(rotated.join('\0'), rotated)
  }

  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      if (recordedEdges.has(`${from}\0${to}`)) continue
      const predecessor = new Map([[to, undefined]])
      const queue = [to]
      for (let cursor = 0; cursor < queue.length && !predecessor.has(from); cursor += 1) {
        for (const next of adjacency.get(queue[cursor]) ?? []) {
          if (predecessor.has(next)) continue
          predecessor.set(next, queue[cursor])
          queue.push(next)
        }
      }
      if (!predecessor.has(from)) continue
      // The path to -> ... -> from, closed by the unrecorded edge from -> to.
      const cycle = []
      for (let node = from; node !== undefined; node = predecessor.get(node)) cycle.unshift(node)
      report(cycle)
    }
  }

  const recordedAdjacency = new Map()
  for (const [from, targets] of adjacency) {
    const recorded = targets.filter(to => recordedEdges.has(`${from}\0${to}`))
    if (recorded.length > 0) recordedAdjacency.set(from, recorded)
  }
  // Each simple cycle is walked once, from its smallest package: a path only
  // extends to packages that sort after its first.
  const extend = (path, onPath) => {
    for (const next of recordedAdjacency.get(path[path.length - 1]) ?? []) {
      if (next === path[0]) {
        if (!recordedCycles.has(path.join('\0'))) report(path)
      } else if (next > path[0] && !onPath.has(next)) {
        extend([...path, next], new Set([...onPath, next]))
      }
    }
  }
  for (const start of [...recordedAdjacency.keys()].sort()) extend([start], new Set([start]))

  const byLengthThenName = (a, b) => a.length - b.length || (a.join('\0') < b.join('\0') ? -1 : 1)
  return {
    cycles: [...found.values()]
      .filter(cycle => !exemptedCycles.some(entry => entry.cycle.length === cycle.length && entry.cycle.every(pkg => cycle.includes(pkg))))
      .sort(byLengthThenName),
    stale: exemptedCycles.filter(entry => recordEdges(entry.cycle).some(edge => !graphEdges.has(edge))),
  }
}

/**
 * Run the full layer-dependency gate against a real repository or fixture root.
 * @param root - repository (or fixture) root.
 * @returns violations, every unexempted cycle, unclassified packages, kernel edges, and scan counts.
 */
export function runLayerDepsCheck(root) {
  const { byPackage, unclassified, vendored } = classifyWorkspacePackages(root)
  const exemptions = readLayerExemptions(root)
  const violations = []
  const findings = []
  for (const error of exemptions.errors) violations.push({ rule: 'malformed-exemption-store', fromPackage: '', toPackage: '', detail: error })
  for (const name of unclassified) {
    violations.push({ rule: 'unclassified-package', fromPackage: name, toPackage: '', detail: `${name} matched no capability-family role and no packages/<group> entry` })
  }

  const { edges, facts, singletonBindings } = collectLayerEdges(root, byPackage)
  const allowed = new Map(exemptions.kernelEdgeAllowlist.map(entry => [`${entry.fromPackage}\0${entry.toPackage}`, entry]))
  const usedAllowances = new Set()
  const today = new Date().toISOString().slice(0, 10)

  const vendoredNames = new Set([CORDIS_PACKAGE, ...vendored.keys()])
  const workspaceNames = new Set([...byPackage.keys(), ...vendoredNames, ...unclassified])
  const kernelEdges = []
  for (const { external, ...entry } of collectKernelNonWorkspaceEdges(root, byPackage, vendoredNames, workspaceNames)) {
    const forbidden = entry.toPackage === CORDIS_PACKAGE && entry.fromPackage === TRUST_KERNEL_PACKAGE
      ? entry.bindings.filter(binding => !KERNEL_PERMITTED_CORDIS_BINDINGS.has(binding))
      : entry.bindings
    if (forbidden.length === 0) {
      kernelEdges.push({ ...withoutBindingFiles(entry), verdict: 'permitted-binding' })
      continue
    }
    // An allowlist entry never admits a kernel edge to a vendored or external
    // package (layering.md rule 7). Naming one still counts as a use, so the
    // entry reports as expired rather than stale once its date passes.
    const key = `${entry.fromPackage}\0${entry.toPackage}`
    if (allowed.has(key)) usedAllowances.add(key)
    kernelEdges.push({ ...withoutBindingFiles(entry), verdict: 'violation' })
    const forbiddenFiles = [...new Set(forbidden.flatMap(binding => [...entry.bindingFiles.get(binding) ?? []]))].sort()
    violations.push({
      rule: external ? 'kernel-external-dependency' : 'kernel-forbidden-cordis-binding',
      fromPackage: entry.fromPackage,
      toPackage: entry.toPackage,
      detail: external
        ? `depends on the external package ${entry.toPackage} through ${forbidden.join(', ')} in ${forbiddenFiles.join(', ')} (rule 4 permits a kernel package no external dependency)`
        : `depends on ${entry.toPackage} through ${forbidden.join(', ')} in ${forbiddenFiles.join(', ')} (rule 4 permits only ${TRUST_KERNEL_PACKAGE}, and it only the Context import binding, the ${CORDIS_PACKAGE} peer declaration it needs, and a declare-module augmentation of the Context interface)`,
    })
  }

  const spawnTargets = []
  for (const edge of edges) {
    // An unranked position may depend on any layer, so its own outgoing edges
    // never reach classifyEdge (layering.md rule 1).
    if (UNRANKED_POSITIONS.has(edge.fromLayer)) continue
    // The half that makes each position a rule rather than an exemption: no
    // ranked layer may depend on an unranked one.
    const inbound = UNRANKED_POSITIONS.get(edge.toLayer)
    if (inbound !== undefined) {
      // layering.md rule 8: a spawn-target dependency. The rule against
      // depending on an unranked position is about CODE coupling -- rule 1 was
      // written with `import` in mind and the Detection section lists three
      // code channels only, so a process boundary was never in its range. A
      // package that resolves a manifest path to spawn an executable, and
      // imports no symbol from it, is not coupled to its code.
      //
      // Condition (i) is the whole safety of this exception and is decided
      // here, not by a name list: zero imported bindings. A package that both
      // spawns and imports falls straight through to the violation below, with
      // nobody's judgement involved. (ii) the dependency is declared, so it can
      // never rest on hoisting; the edge reaching this point via
      // `package-graph` IS that declaration.
      const importedFromTarget = facts.get(edge.fromPackage)?.importedBindings.get(edge.toPackage)
      const importsNoSymbol = importedFromTarget === undefined || importedFromTarget.size === 0
      if (importsNoSymbol && edge.detectionMethod === 'package-graph') {
        spawnTargets.push({ fromPackage: edge.fromPackage, toPackage: edge.toPackage })
        continue
      }
      violations.push({
        rule: inbound.rule,
        fromPackage: edge.fromPackage,
        toPackage: edge.toPackage,
        detail: `${edge.fromLayer} -> ${edge.toLayer} via ${edge.detectionMethod}; nothing may depend on ${inbound.label} (${inbound.reference})`,
      })
      continue
    }
    const verdict = classifyEdge(edge)
    if (verdict === 'ok' || verdict === 'narrow-event-type-allowed') continue
    const key = `${edge.fromPackage}\0${edge.toPackage}`
    const allowance = edge.fromLayer === 'kernel' ? allowed.get(key) : undefined
    if (allowance !== undefined) {
      usedAllowances.add(key)
      // acceptance[1]: no entry admits a kernel edge to a UI package or a
      // model provider (layering.md rule 7).
      if (allowance.expires >= today && edge.toLayer !== 'providers' && edge.toLayer !== 'surfaces-apps') {
        kernelEdges.push({ fromPackage: edge.fromPackage, toPackage: edge.toPackage, bindings: [], files: [], verdict: 'allowlisted' })
        continue
      }
    }
    if (verdict === 'global-singleton-violation') {
      const reached = singletonBindings.get(`${edge.fromPackage} ${edge.toPackage}`) ?? []
      violations.push({
        rule: 'global-singleton',
        fromPackage: edge.fromPackage,
        toPackage: edge.toPackage,
        detail: `imports the mutable module-level binding(s) ${reached.join(', ')} (layering.md rule 3: reaching another package's state through a module-level singleton instead of the ctx-based seam)`,
      })
      continue
    }
    const entry = {
      rule: edge.fromLayer === 'kernel' ? 'kernel-upward-dependency' : 'layer-violation',
      fromPackage: edge.fromPackage,
      toPackage: edge.toPackage,
      detail: `${edge.fromLayer} -> ${edge.toLayer ?? 'outside the six-layer graph'} via ${edge.detectionMethod}`,
    }
    // A generic upward edge is a reported FINDING, not a pass condition: no
    // registry clause requires zero of them (must[0] says define the order,
    // must[2] says detect the channels, acceptance[0] is about cycles, and the
    // gate names only the kernel-reverse-edge and expired-allowlist zeros). A
    // kernel upward edge is different -- acceptance[1] and the gate both
    // require it to be zero.
    if (entry.rule === 'kernel-upward-dependency') violations.push(entry)
    else findings.push(entry)
  }

  for (const entry of exemptions.kernelEdgeAllowlist) {
    const key = `${entry.fromPackage}\0${entry.toPackage}`
    if (!usedAllowances.has(key)) {
      violations.push({
        rule: 'stale-kernel-edge-allowlist',
        fromPackage: entry.fromPackage,
        toPackage: entry.toPackage,
        detail: 'allowlist entry names an edge that no longer exists — remove it (layering.md rule 7)',
      })
      continue
    }
    if (entry.expires < today) {
      violations.push({
        rule: 'expired-kernel-edge-allowlist',
        fromPackage: entry.fromPackage,
        toPackage: entry.toPackage,
        detail: `allowlist entry expired ${entry.expires} (owner ${entry.owner}) — remove the edge or re-justify it (layering.md rule 7)`,
      })
    }
  }

  // layering.md rule 3, second half: a shared mutable global couples two
  // packages with no import edge at all, so no package-graph or path-alias
  // walk can see it. A key only counts when some workspace package writes it,
  // which is what keeps a host global (globalThis.crypto, globalThis.process)
  // from ever matching.
  for (const [reader, readerFacts] of facts) {
    for (const [key, readFile] of readerFacts.globalReads) {
      // A platform global that a package merely polyfills is not "another
      // layer's state": reading globalThis.fetch is using a Web API, and a
      // worker runtime installing a fetch polyfill does not couple every
      // caller to that runtime. The test is mechanical rather than a
      // hand-written allowlist -- the key must not already exist on this
      // process's globalThis. Its known limit: a DOM-only global absent from
      // Node (`window.customElements`) is not filtered here, and would be
      // reported if some workspace package also assigned it.
      if (key in globalThis) continue
      for (const [writer, writerFacts] of facts) {
        if (writer === reader || !writerFacts.globalWrites.has(key)) continue
        violations.push({
          rule: 'global-singleton',
          fromPackage: reader,
          toPackage: writer,
          detail: `both reach the shared global '${key}' (read ${readFile}, written ${writerFacts.globalWrites.get(key)}) — layering.md rule 3 forbids this channel regardless of layer direction`,
        })
      }
    }
  }

  const productionEdges = edges.filter(edge => edge.detectionMethod === 'package-graph')
  const { cycles, stale } = findUnexemptedCycles([...productionEdges, ...collectVendoredEdges(byPackage, vendored)], exemptions.exemptedCycles)
  for (const [index, cycle] of cycles.entries()) {
    violations.push({
      rule: 'unexempted-cycle',
      fromPackage: cycle[0],
      toPackage: cycle[cycle.length - 1],
      detail: `${index === 0 ? 'shortest cycle' : 'cycle'}: ${cycle.join(' -> ')} -> ${cycle[0]}`,
    })
  }
  for (const entry of stale) {
    violations.push({
      rule: 'stale-exempted-cycle',
      fromPackage: entry.cycle[0],
      toPackage: entry.cycle[entry.cycle.length - 1],
      detail: `exempted cycle ${entry.cycle.join(' -> ')} -> ${entry.cycle[0]} names an edge the production graph does not have — remove the record (layering.md rule 5)`,
    })
  }

  return {
    violations,
    findings,
    unexemptedCycles: cycles,
    shortestCycle: cycles[0],
    unclassified,
    kernelEdges,
    scanned: {
      packages: byPackage.size,
      vendored: vendored.size,
      workspacePackages: byPackage.size + vendored.size + unclassified.length,
      edges: edges.length,
      layers: LAYER_ORDER.length,
    },
  }
}

/**
 * Render the reported findings as the persistent report's Markdown body.
 * @param result - the gate result whose findings to render.
 * @param elapsed - the measured run time in seconds.
 * @returns the report text.
 */
function renderFindings(result, elapsed) {
  const byTransition = new Map()
  const byTarget = new Map()
  for (const finding of result.findings) {
    const transition = finding.detail.split(' via ')[0]
    byTransition.set(transition, (byTransition.get(transition) ?? 0) + 1)
    byTarget.set(finding.toPackage, (byTarget.get(finding.toPackage) ?? 0) + 1)
  }
  const rank = map => [...map].sort((a, b) => b[1] - a[1]).map(([key, count]) => `| ${key} | ${count} |`)
  return [
    '# Layer findings',
    '',
    'Generated by `pnpm run architecture:layers --write-findings`. **These are observations, not pass conditions.**',
    `${GATE} fails on the four zeros in [layering.md](../../docs/architecture/layering.md#pass-conditions-and-observations); everything below is reported so it is neither hidden nor mistaken for accepted status quo.`,
    '',
    `Scan: ${result.scanned.packages} classified packages, ${result.scanned.edges} edges, ${elapsed}s. Findings: ${result.findings.length}.`,
    '',
    '## By layer transition',
    '',
    '| Transition | Count |',
    '|---|---|',
    ...rank(byTransition),
    '',
    '## By target package',
    '',
    '| Package | Count |',
    '|---|---|',
    ...rank(byTarget),
    '',
    '## Every finding',
    '',
    '| From | To | Detail |',
    '|---|---|---|',
    ...result.findings
      .map(finding => `| \`${finding.fromPackage}\` | \`${finding.toPackage}\` | ${finding.detail} |`)
      .sort(),
    '',
  ].join('\n')
}

function main(argv) {
  const rootFlag = argv.indexOf('--repo-root')
  const root = rootFlag === -1 ? resolve(import.meta.dirname, '../..') : resolve(argv[rootFlag + 1])
  const budgetFlag = argv.indexOf('--budget-ms')
  const budgetMs = budgetFlag === -1 ? TIME_BUDGET_MS : Number(argv[budgetFlag + 1])
  if (!Number.isFinite(budgetMs) || budgetMs < 0) throw new Error(`${GATE}: --budget-ms requires a non-negative number of milliseconds`)
  const result = runLayerDepsCheck(root)
  // performance.now() counts from this process's start, so the budget covers
  // loading tsx and TypeScript as well as the scan; the pnpm and tsx launcher
  // processes that start this one are outside it.
  const elapsedMs = performance.now()
  const elapsed = (elapsedMs / 1000).toFixed(2)
  const overBudget = elapsedMs > budgetMs
  for (const violation of result.violations) {
    process.stderr.write(`${GATE}: ${violation.rule}: ${violation.fromPackage} -> ${violation.toPackage}: ${violation.detail}\n`)
  }
  // Findings go to stdout, labelled, so they are never read as failure
  // conditions and never silently dropped either.
  for (const finding of result.findings) {
    process.stdout.write(`${GATE}: finding (not a failure): ${finding.rule}: ${finding.fromPackage} -> ${finding.toPackage}: ${finding.detail}\n`)
  }
  if (argv.includes('--write-findings')) {
    writeFileSync(resolve(root, FINDINGS_PATH), renderFindings(result, elapsed))
    process.stdout.write(`${GATE}: wrote ${result.findings.length} finding(s) to ${FINDINGS_PATH}\n`)
  }
  if (overBudget) process.stderr.write(`${GATE}: time-budget: the run took ${elapsed}s, over its ${(budgetMs / 1000).toFixed(2)}s budget (acceptance[2])\n`)
  const summary = `${GATE}: ${result.violations.length} violation(s) and ${result.findings.length} reported finding(s) across ${result.scanned.packages} classified and ${result.scanned.vendored} vendored package(s) of ${result.scanned.workspacePackages} workspace package(s), ${result.scanned.edges} dependency edge(s), ${LAYER_ORDER.length} layers + composition roots and test-support, in ${elapsed}s.\n`
  process.stdout.write(summary)
  return result.violations.length === 0 && !overBudget ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2))
}
