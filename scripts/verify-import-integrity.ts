/**
 * Reject a RUNTIME import in a package's `src/` that its own manifest does not
 * declare.
 *
 * **What this catches that `verify-package-dependencies` cannot.** That gate
 * decides, for a dependency a manifest ALREADY declares, which section it
 * belongs in and what range it carries. It is a policy check over declared
 * edges, so deleting a declaration outright removes the edge it would have
 * judged and the gate stays green — measured on this tree, not assumed.
 * Completeness is the other half of the question: does every package the
 * source actually loads appear in the manifest at all. P4-11 is the worked
 * example. `dsh-retry/usage` imported `@deepseek-ai/schemastery` with no
 * declaration; the source plane resolved it through the workspace root, and the
 * failure surfaced only on the artifact plane, where the shipped profile booted
 * from built `lib/` under strict resolution and every snapshot reddened at once.
 *
 * **Runtime uses only, and that is this repository's existing rule rather than
 * a choice made here.** `import type` is erased, and this repo deliberately
 * leaves type-only edges undeclared: measured before this gate was written,
 * treating them as requiring a declaration reported 1063 violations, almost all
 * of them `import type` lines that the whole codebase is written to allow —
 * `@deepseek-ai/dsh-agent`'s `import type { Branded }` among them. So the
 * decision of what counts as a load is delegated to
 * {@link collectRuntimeSourceExportUses}, the collector
 * `verify-package-dependencies` already uses, rather than to a second AST walk
 * that would drift from it.
 *
 * **Why `devDependencies` does not count.** A package's `src/` is what ships. A
 * consumer installing it receives `dependencies`, `peerDependencies` and
 * `optionalDependencies` and nothing else, so a dev-only declaration satisfies
 * the local build and breaks the install. `tests/` is out of scope for the same
 * reason inverted: it never ships, so a dev declaration is exactly right there.
 *
 * **Scope, and its two deliberate holes, both measured.**
 * `packages/<group>/<pkg>/src` and `apps/<app>/src`, HOST face only.
 *
 * `vendor/*` is out: those manifests are pinned upstream copies, an undeclared
 * import in one is an upstream defect, and the remedy is the sync procedure in
 * `vendor/README.md` rather than an edit this gate would be demanding.
 *
 * **Client-face sources are out, and the number says why.** Under the static
 * rule this repository has 332 undeclared runtime imports; **320 of them are
 * Client face** (`packages/client/*`, and any `src/client/` subtree), almost
 * all reaching `dsh-client-store`, `dsh-client-ui-primitives` and
 * `dsh-client-ui-slots`. A Client bundle is built by Vite through the tsconfig
 * path aliases, so for that face the alias IS the resolution contract and a
 * manifest declaration is not what makes the import work. 320 findings that
 * describe a deliberate, uniform practice would be a gate arguing with the
 * architecture; the 12 Host-face findings that remain are each a real
 * artifact-plane hazard. Whether the Client face SHOULD declare those edges is
 * a real question and a separate one — it is recorded for the delegate rather
 * than answered by this gate's exit code.
 *
 * Usage: `pnpm run verify-import-integrity`
 *
 * @module scripts/verify-import-integrity
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collectRuntimeSourceExportUses, readWorkspacePackageManifests } from './verify-package-dependencies.ts'
import type { PackageDependencyManifest } from './verify-package-dependencies.ts'

const root = resolve(import.meta.dirname, '..')

/** Source files a published `src/` can contain. */
const SOURCE_GLOB = 'src/**/*.{ts,tsx,mts,cts}'

/** The sections an installed consumer actually receives. */
const SHIPPED_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

/**
 * Whether a source path belongs to the Client compiler face.
 *
 * Two spellings, both real in this tree: a whole `packages/client/*` package,
 * and a `src/client/` subtree inside a Host package (the api controllers do
 * this). Matching the subtree rather than only the package keeps the 320
 * bundler-resolved imports out of a Host-face verdict.
 * @param file - repo-relative source path.
 * @returns true when the file ships through the Client bundle.
 */
export function isClientFaceSource(file: string): boolean {
  return file.startsWith('packages/client/') || file.includes('/src/client/')
}

/** One undeclared runtime import, named where a reader can go fix it. */
export interface UndeclaredImport {
  /** The importing package's manifest name. */
  readonly pkg: string
  /** The package name that is loaded and not declared. */
  readonly missing: string
  /** Repo-relative path of the importing file. */
  readonly file: string
  /** 1-based line of the import. */
  readonly line: number
}

/**
 * The package name a module specifier resolves to, or `undefined` when it names
 * no package.
 * @param specifier - an import specifier, possibly a subpath.
 * @returns the bare package name keeping a leading scope; `undefined` for a
 * relative path, an absolute path, a `#` import-map entry, or any `scheme:`
 * specifier (`node:fs` included).
 */
export function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#') || specifier.includes(':')) {
    return undefined
  }
  const parts = specifier.split('/')
  if (!specifier.startsWith('@')) return parts[0]
  return parts.length >= 2 ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : undefined
}

/**
 * The package names one manifest declares in the sections a consumer installs.
 * @param manifest - a parsed manifest.
 * @returns every declared name across `dependencies`, `peerDependencies` and
 * `optionalDependencies`.
 */
export function shippedDeclarations(manifest: PackageDependencyManifest): ReadonlySet<string> {
  const declared = new Set<string>()
  for (const section of SHIPPED_SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) declared.add(name)
  }
  return declared
}

/**
 * Every runtime import in a shipped `src/` that its own manifest does not declare.
 *
 * One violation per (package, missing name, file): a file importing three
 * exports of one undeclared package has one fix, and three lines would make the
 * report argue for itself.
 * @param repoRoot - absolute repository root.
 * @returns violations, sorted by package, then missing name, then file.
 */
export function undeclaredImports(repoRoot: string): readonly UndeclaredImport[] {
  const violations: UndeclaredImport[] = []
  for (const pkg of readWorkspacePackageManifests(repoRoot).all) {
    // Vendored packages are pinned copies; see the scope note above.
    if (pkg.dir.startsWith('vendor/')) continue
    const declared = new Set(shippedDeclarations(pkg.manifest))
    // A package reaches its own subpaths by name through its own `exports` map.
    // That is a self-reference, and declaring it would be a cycle.
    declared.add(pkg.name)
    for (const relative of globSync(SOURCE_GLOB, { cwd: resolve(repoRoot, pkg.dir) }).sort()) {
      const file = `${pkg.dir}/${relative.replaceAll('\\', '/')}`
      if (isClientFaceSource(file)) continue
      const uses = collectRuntimeSourceExportUses(file, readFileSync(resolve(repoRoot, file), 'utf8'))
      const reported = new Set<string>()
      for (const use of uses) {
        const name = packageNameOf(use.specifier)
        if (name === undefined || declared.has(name) || reported.has(name)) continue
        reported.add(name)
        violations.push({ pkg: pkg.name, missing: name, file, line: use.line })
      }
    }
  }
  return violations.sort((a, b) =>
    a.pkg.localeCompare(b.pkg) || a.missing.localeCompare(b.missing) || a.file.localeCompare(b.file))
}

/** Report every undeclared runtime import and exit nonzero when any exists. */
function main(): void {
  const violations = undeclaredImports(root)
  if (violations.length > 0) {
    console.error(`verify-import-integrity: ${String(violations.length)} undeclared runtime import(s) in shipped src/:`)
    for (const { pkg, missing, file, line } of violations) {
      console.error(`  ${pkg}: missing ${missing} (imported at ${file}:${String(line)})`)
    }
    console.error('  Each must appear in that package\'s dependencies, peerDependencies or optionalDependencies; devDependencies does not ship.')
    process.exit(1)
  }
  console.log('verify-import-integrity: every runtime import in a shipped src/ is declared by its own manifest.')
}

// Only when run as a command. The spec imports the pure functions above.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main()
