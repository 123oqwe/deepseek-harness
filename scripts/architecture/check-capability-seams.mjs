/**
 * Real capability-seam architecture gate (Epic P0-03, U-stage): reads
 * `architecture.layers.json`, walks the real workspace's `package.json`
 * manifests and TypeScript source imports, and feeds the resolved facts into
 * `./capability-seams.ts`'s pure detector functions. Plain ESM (not
 * TypeScript) so it runs the same way as every other tsx-launched gate
 * script while importing the `.ts` detector module directly — see
 * `docs/development.md#typescript-project-layout` on source-plane gates.
 *
 * Run: `pnpm run architecture:seams` (`tsx scripts/architecture/check-capability-seams.mjs
 * [--repo-root <path>]`). `--repo-root` defaults to this script's own repository
 * root (not `process.cwd()`) and exists for fixture-driven end-to-end tests
 * (`tests/architecture/check-capability-seams.spec.ts`), matching
 * `scripts/release/baseline-fingerprint.mjs`'s CLI.
 */

import { readFileSync, globSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import {
  detectDeepImportViolation,
  detectMissingProviderViolations,
  detectNonReversibleRegistrationViolation,
  detectProviderAppDependencyViolation,
  isAllowlisted,
  validateArchitectureLayers,
} from './capability-seams.ts'

const GATE = 'check-capability-seams'
const LAYERS_PATH = 'architecture.layers.json'
const PACKAGE_MANIFEST_GLOB = 'packages/*/*/package.json'
const CLIENT_APP_MANIFEST_GLOB = 'packages/client/*/package.json'
const TOP_LEVEL_APP_MANIFEST_GLOB = 'apps/*/package.json'
const SOURCE_GLOB = 'src/**/*.{ts,tsx,mts,cts}'
const TEST_GLOB = 'tests/**/*.spec.ts'
/**
 * Cordis's own vocabulary for reverse teardown: a Service's disposer and
 * `ctx.effect()`'s returned disposer ARE this codebase's unload/rollback path
 * (AGENTS.md: "a registry's register() returns the disposer"), so a test
 * asserting disposal behavior counts as an unload/rollback test.
 */
const UNLOAD_ROLLBACK_PATTERN = /\b(?:unload|rollback|dispose)\b/i

function normalizePath(path) {
  return path.split(sep).join('/')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Read the real `architecture.layers.json` document.
 * @param root - repository (or fixture) root.
 * @returns the parsed document, unvalidated.
 */
export function readArchitectureLayers(root) {
  return readJson(resolve(root, LAYERS_PATH))
}

/**
 * Read every real workspace package under `packages/<group>/<pkg>`.
 * @param root - repository (or fixture) root.
 * @returns npm package name -> repo-relative package directory.
 */
export function readWorkspacePackages(root) {
  const byName = new Map()
  for (const manifestPath of globSync(PACKAGE_MANIFEST_GLOB, { cwd: root }).map(normalizePath).sort()) {
    const manifest = readJson(resolve(root, manifestPath))
    if (typeof manifest.name === 'string') byName.set(manifest.name, dirname(manifestPath))
  }
  return byName
}

/**
 * Read real npm package names classified as application/UI code: browser UI
 * packages under `packages/client/*` and the top-level applications under
 * `apps/*` (the CLI and the web front end) — never a capability family's
 * Service Definition or Provider directory.
 * @param root - repository (or fixture) root.
 * @returns application/UI npm package names.
 */
export function readAppPackages(root) {
  const names = new Set()
  for (const glob of [CLIENT_APP_MANIFEST_GLOB, TOP_LEVEL_APP_MANIFEST_GLOB]) {
    for (const manifestPath of globSync(glob, { cwd: root })) {
      const manifest = readJson(resolve(root, manifestPath))
      if (typeof manifest.name === 'string') names.add(manifest.name)
    }
  }
  return names
}

function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#') && !specifier.includes(':')
}

/** npm package name a bare specifier resolves to (scoped packages: first two segments). */
function packageNameOf(specifier) {
  const segments = specifier.split('/')
  return segments.slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
}

/** Whether a bare specifier reaches into its package's `src/*` rather than a published entry point. */
function isDeepImportSpecifier(specifier, packageName) {
  const rest = specifier.slice(packageName.length).replace(/^\//, '')
  return rest === 'src' || rest.startsWith('src/')
}

/**
 * Collect every bare-specifier import/export/require target in one
 * TypeScript source file, following the `ts.createSourceFile` +
 * `ts.forEachChild` AST-walk pattern `scripts/verify-package-dependencies.ts`
 * and `scripts/verify-client-packages.ts` use for real import scanning.
 * Runtime and type-only specifiers are both collected: a deep import into a
 * provider's `src/*` couples callers to internal implementation types even
 * when erased at runtime.
 * @param path - file path, used to select TypeScript's parser mode.
 * @param source - source text to inspect.
 * @returns raw specifier text for every import/export/require target.
 */
export function collectImportSpecifiers(path, source) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const specifiers = []
  const add = (node) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      add(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      add(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

/**
 * Real resolved import edges for every workspace package's `src/**`
 * TypeScript sources (must[1]'s "TypeScript imports" scan).
 * @param root - repository (or fixture) root.
 * @param packages - real workspace packages from {@link readWorkspacePackages}.
 * @returns one {@link ResolvedImport}-shaped record per bare cross-package specifier.
 */
export function collectResolvedImports(root, packages) {
  const imports = []
  for (const [packageName, dir] of packages) {
    for (const sourcePath of globSync(SOURCE_GLOB, { cwd: resolve(root, dir) }).sort()) {
      const absolute = resolve(root, dir, sourcePath)
      const source = readFileSync(absolute, 'utf8')
      const fromFile = normalizePath(`${dir}/${sourcePath}`)
      for (const specifier of collectImportSpecifiers(absolute, source)) {
        if (!isBareSpecifier(specifier)) continue
        const toPackage = packageNameOf(specifier)
        if (toPackage === packageName) continue
        imports.push({
          fromPackage: packageName,
          fromFile,
          toPackage,
          toSpecifier: specifier,
          toIsDeepImport: isDeepImportSpecifier(specifier, toPackage),
        })
      }
    }
  }
  return imports
}

function testFilesOf(root, packages, packageName) {
  const dir = packages.get(packageName)
  if (dir === undefined) return []
  return globSync(TEST_GLOB, { cwd: resolve(root, dir) }).map(rel => resolve(root, dir, rel))
}

/**
 * Real must[2] test evidence for one capability family: whether any provider
 * package owns a test file (provider fixture); whether any consumer
 * package's test imports a provider or the family's own Service Definition
 * (consumer composition test); and whether any provider or consumer test
 * exercises unload/rollback/dispose behavior.
 * @param root - repository (or fixture) root.
 * @param packages - real workspace packages from {@link readWorkspacePackages}.
 * @param family - the capability family to evaluate.
 * @returns real {@link CapabilityTestEvidence} for `family.id`.
 */
export function readCapabilityTestEvidence(root, packages, family) {
  const hasProviderFixture = family.providers.some(provider => testFilesOf(root, packages, provider).length > 0)

  const compositionTargets = new Set([...family.providers, family.definition])
  const consumerTestFiles = family.consumers.flatMap(consumer => testFilesOf(root, packages, consumer))
  const hasConsumerCompositionTest = consumerTestFiles.some((file) => {
    const source = readFileSync(file, 'utf8')
    return collectImportSpecifiers(file, source)
      .filter(isBareSpecifier)
      .some(specifier => compositionTargets.has(packageNameOf(specifier)))
  })

  const lifecycleTestFiles = [...family.providers, ...family.consumers].flatMap(name => testFilesOf(root, packages, name))
  const hasUnloadRollbackTest = lifecycleTestFiles.some(file => UNLOAD_ROLLBACK_PATTERN.test(readFileSync(file, 'utf8')))

  return { familyId: family.id, hasProviderFixture, hasConsumerCompositionTest, hasUnloadRollbackTest }
}

/** Whether `value` is a non-null, non-array object — the runtime shape a `families[i]`/`allowlist[i]` element must have before this scanner reads any of its fields. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether `layers.families` and `layers.allowlist` are arrays, every element
 * of each array is itself a well-formed object (not `null`, a string, a
 * number, ...), and every family's `providers`/`consumers` are arrays — the
 * minimum real shape the detector functions below (and `isAllowlisted`)
 * assume when they iterate or index into a family or allowlist entry.
 * `validateArchitectureLayers` already reports a clear schema error for each
 * malformed field or element; this only decides whether it is safe to keep
 * scanning.
 * @param layers - the parsed `architecture.layers.json` document.
 * @returns whether every array field and element the scan reads is actually well-formed.
 */
function hasScannableShape(layers) {
  return Array.isArray(layers.families)
    && Array.isArray(layers.allowlist)
    && layers.families.every(family =>
      isPlainObject(family) && Array.isArray(family.providers) && Array.isArray(family.consumers))
    && layers.allowlist.every(entry => isPlainObject(entry))
}

/**
 * Run the complete capability-seam gate against a real (or fixture)
 * repository root: load `architecture.layers.json`, scan the real workspace,
 * and feed the resolved facts into `./capability-seams.ts`'s pure detectors.
 * A document whose `families`/`allowlist`/per-family `providers`/`consumers`
 * are not arrays, or whose `families`/`allowlist` hold a non-object element,
 * fails closed: `schemaErrors` names the malformed field or element and
 * `violations` stays empty rather than scanning against an unsafe shape.
 * @param root - repository (or fixture) root.
 * @returns document schema errors and unsuppressed seam violations.
 */
export function runCapabilitySeamsCheck(root) {
  const layers = readArchitectureLayers(root)
  const packages = readWorkspacePackages(root)
  const appPackages = readAppPackages(root)
  const workspacePackageNames = new Set(packages.keys())

  const schemaErrors = validateArchitectureLayers(layers, workspacePackageNames)
  if (!hasScannableShape(layers)) {
    const families = Array.isArray(layers.families) ? layers.families.length : 0
    return { schemaErrors, violations: [], scanned: { packages: packages.size, imports: 0, families } }
  }

  const resolvedImports = collectResolvedImports(root, packages)
  const violations = []
  for (const edge of resolvedImports) {
    const deepImport = detectDeepImportViolation(edge, layers)
    if (deepImport !== null) violations.push(deepImport)
    const providerApp = detectProviderAppDependencyViolation(edge, layers, appPackages)
    if (providerApp !== null) violations.push(providerApp)
  }
  violations.push(...detectMissingProviderViolations(layers))
  for (const family of layers.families) {
    const evidence = readCapabilityTestEvidence(root, packages, family)
    const nonReversible = detectNonReversibleRegistrationViolation(evidence, layers)
    if (nonReversible !== null) violations.push(nonReversible)
  }

  return {
    schemaErrors,
    violations: violations.filter(violation => !isAllowlisted(violation, layers)),
    scanned: { packages: packages.size, imports: resolvedImports.length, families: layers.families.length },
  }
}

/**
 * Render one violation as CI-actionable output naming the dependency edge,
 * source file, and a remediation suggestion (acceptance[3]).
 * @param violation - the violation to render.
 * @returns a single human-readable diagnostic line.
 */
export function formatViolation(violation) {
  return `  [${violation.kind}] ${violation.edge.from} -> ${violation.edge.to} (${violation.sourceFile}): ${violation.remediation}`
}

/**
 * Resolve the repository root a CLI invocation scans: an explicit
 * `--repo-root <path>` argument (fixture-driven end-to-end tests), or this
 * script's own repository root otherwise — never `process.cwd()`, so the
 * gate scans the same tree no matter where it is invoked from.
 * @param args - CLI arguments (`process.argv.slice(2)`).
 * @returns the resolved repository root.
 */
export function repoRootArg(args) {
  const index = args.indexOf('--repo-root')
  if (index === -1) return resolve(import.meta.dirname, '..', '..')
  if (index + 1 >= args.length) throw new Error(`${GATE}: --repo-root requires a path`)
  return resolve(args[index + 1])
}

/** CLI entry: run the gate against the repository root and report. @returns Nothing. */
export function main() {
  const root = repoRootArg(process.argv.slice(2))
  const { schemaErrors, violations, scanned } = runCapabilitySeamsCheck(root)
  if (schemaErrors.length === 0 && violations.length === 0) {
    console.log(
      `${GATE}: 0 violation(s) across ${String(scanned.families)} capability famil${scanned.families === 1 ? 'y' : 'ies'}, `
      + `${String(scanned.imports)} cross-package import edge(s) in ${String(scanned.packages)} workspace package(s).`,
    )
    return
  }
  if (schemaErrors.length > 0) {
    console.error(`${GATE}: ${String(schemaErrors.length)} architecture.layers.json schema error(s):`)
    for (const error of schemaErrors) console.error(`  ${error}`)
  }
  if (violations.length > 0) {
    console.error(`${GATE}: ${String(violations.length)} capability-seam violation(s):`)
    for (const violation of violations) console.error(formatViolation(violation))
  }
  process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
