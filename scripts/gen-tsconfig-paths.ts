/**
 * Expand the workspace path aliases that a wildcard would otherwise resolve by
 * probing every package group in turn.
 *
 * `tsconfig.base.json` is the resolution facade for the whole repository, and
 * two of its aliases used one key per *group* rather than per package:
 * `@deepseek-ai/dsh-*` listed 49 candidate globs and `@deepseek-ai/dsh-*\/invariant`
 * listed 45. TypeScript and tsx try those candidates in order, so a specifier
 * whose package sits late in the list pays for every earlier miss. Under tsx's
 * ESM hook each miss is an `ERR_MODULE_NOT_FOUND` that Node decorates with a
 * full CommonJS resolution walk, which dominated source-launch boot.
 *
 * This generator writes one explicit entry per package into a marked region of
 * `tsconfig.base.json`, leaving every hand-written alias and comment outside
 * that region untouched. `--check` reports drift instead of writing, so a new
 * package that needs an alias fails a gate rather than silently resolving
 * through a fallback that no longer exists.
 *
 * @module scripts/gen-tsconfig-paths
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG = join(ROOT, 'tsconfig.base.json')
const BEGIN = '      // BEGIN generated package aliases — pnpm run gen-tsconfig-paths'
const END = '      // END generated package aliases'

/** Package-name prefix the expanded aliases cover. */
const PREFIX = '@deepseek-ai/dsh-'

/** One workspace package the generated region maps. */
interface PackageAlias {
  /** Bare specifier, e.g. `@deepseek-ai/dsh-session`. */
  readonly specifier: string
  /** Repository-relative source directory, e.g. `./packages/session/session/src`. */
  readonly source: string
  /** Whether the package carries `src/invariant.ts`, which earns a second alias. */
  readonly hasInvariant: boolean
  /**
   * Subpaths the package's own `exports` publishes, each earning an alias.
   *
   * Derived rather than hand-listed because hand-listing them failed five
   * times: a published subpath with no alias cannot be resolved on the source
   * plane, so a test importing it silently runs the package's BUILT `lib/`
   * instead. That is invisible until a mutation to the source changes nothing
   * the tests can see (first100 P1-10.P).
   */
  readonly subpaths: readonly string[]
}

/**
 * Read a workspace manifest's declared name.
 * @param manifest - absolute path to a `package.json`.
 * @returns The declared name, or undefined when the file is absent or nameless.
 */
function packageName(manifest: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch (_absentOrUnreadableManifest) {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const name: unknown = (parsed as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

/** One workspace package directory and the name its manifest declares. */
interface WorkspacePackage {
  readonly group: string
  readonly directory: string
  readonly packageDir: string
  readonly name: string
}

/**
 * Walk `packages/<group>/<directory>` once, in a stable order.
 * @returns Every directory whose manifest names a `@deepseek-ai/dsh-` package and that carries `src`.
 */
function workspacePackages(): WorkspacePackage[] {
  const packages = join(ROOT, 'packages')
  const found: WorkspacePackage[] = []
  for (const group of readdirSync(packages).sort()) {
    const groupDir = join(packages, group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const directory of readdirSync(groupDir).sort()) {
      const packageDir = join(groupDir, directory)
      const name = packageName(join(packageDir, 'package.json'))
      if (name === undefined || !name.startsWith(PREFIX)) continue
      if (existsSync(join(packageDir, 'src'))) found.push({ group, directory, packageDir, name })
    }
  }
  return found
}

/**
 * Collect every package the removed wildcards could resolve.
 *
 * A wildcard substituted the specifier's suffix into `packages/<group>/<suffix>/src`,
 * so it only ever resolved a package whose declared name is exactly
 * `@deepseek-ai/dsh-<directory>`. Packages named after something other than
 * their directory already carry a hand-written alias and are skipped here.
 *
 * @returns Aliases sorted by specifier.
 * @throws When two package directories claim one specifier, which the removed
 * wildcards resolved by group order and an explicit map cannot express.
 */
export function collectPackageAliases(): PackageAlias[] {
  const bySpecifier = new Map<string, PackageAlias & { directory: string }>()
  for (const { group, directory, packageDir, name } of workspacePackages()) {
    if (name !== `${PREFIX}${directory}`) continue
    const previous = bySpecifier.get(name)
    if (previous !== undefined) {
      throw new Error(
        `gen-tsconfig-paths: ${name} is claimed by packages/${previous.directory} and packages/${group}/${directory}; `
        + 'an explicit alias cannot express the group-order tiebreak the wildcard used.',
      )
    }
    bySpecifier.set(name, {
      specifier: name,
      source: `./packages/${group}/${directory}/src`,
      hasInvariant: existsSync(join(packageDir, 'src', 'invariant.ts')),
      subpaths: publishedSubpaths(join(packageDir, 'package.json'), packageDir),
      directory: `${group}/${directory}`,
    })
  }
  return [...bySpecifier.values()]
    .map(({ specifier, source, hasInvariant, subpaths }) => ({ specifier, source, hasInvariant, subpaths }))
    .sort((left, right) => left.specifier.localeCompare(right.specifier))
}

/**
 * The subpaths one package's `exports` publishes that a source-plane alias
 * must cover.
 *
 * `./src/*` and `./package.json` are excluded: the first already resolves to
 * source by construction and the second is not a module. A subpath whose
 * matching `src/<name>.ts` does not exist is excluded too — it publishes
 * something built rather than a source module, and aliasing it would point at
 * a file that is not there.
 * @param manifest - absolute path to the package's `package.json`.
 * @param packageDir - the package directory, for checking the source file.
 * @returns the subpath names, without their leading `./`.
 */
export function publishedSubpaths(manifest: string, packageDir: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    return []
  }
  const exported = (parsed as { exports?: unknown }).exports
  if (typeof exported !== 'object' || exported === null) return []
  return Object.keys(exported)
    .filter(key => key.startsWith('./') && key !== './package.json' && !key.includes('*'))
    .map(key => key.slice(2))
    .filter(name => existsSync(join(packageDir, 'src', `${name}.ts`)))
    .sort()
}

/**
 * Collect every workspace package the aliases must cover.
 *
 * Unlike {@link collectPackageAliases} this keeps packages whose name does not
 * match their directory. The generator cannot map those — only a hand-written
 * alias can — but they still have to be mapped by something, because deleting
 * the group wildcards removed the fallback that used to catch them.
 *
 * @returns Declared names of every `@deepseek-ai/dsh-` package carrying a `src` directory.
 */
export function collectPackageNames(): string[] {
  return workspacePackages()
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Read the bare package specifiers a config maps, generated region included.
 * @param text - `tsconfig.base.json` contents.
 * @returns Specifiers mapped without a subpath.
 */
export function mappedSpecifiers(text: string): Set<string> {
  const keys = new Set<string>()
  for (const match of text.matchAll(/^\s*"(@deepseek-ai\/dsh-[^"/]+)":/gm)) {
    const key = match[1]
    if (key !== undefined) keys.add(key)
  }
  return keys
}

/**
 * Report packages that no alias maps.
 *
 * A package missing from `paths` still resolves — through the workspace symlink
 * and the package's own `exports` — but to built `lib/` output rather than to
 * source, which is the artifact-plane leak the explicit aliases exist to avoid.
 * Naming it here turns that into a gate failure instead of a silent difference.
 *
 * @param packages - every workspace package that needs an alias.
 * @param mapped - bare specifiers the config maps.
 * @returns Unmapped package names, in the order given.
 */
export function uncoveredPackages(
  packages: readonly string[],
  mapped: ReadonlySet<string>,
): string[] {
  return packages.filter(name => !mapped.has(name))
}

/**
 * Published subpaths that no alias maps.
 *
 * A published subpath with no alias cannot be resolved on the source plane, so
 * an importer silently gets the package's BUILT `lib/` instead. That is
 * invisible until a mutation to the source changes nothing the tests can see,
 * which is how it was found (first100 P1-10.P) and why it is a gate rather
 * than a convention.
 * Parsed with its own pattern rather than {@link mappedSpecifiers}, whose
 * regex excludes any key containing a slash — it answers "which PACKAGES are
 * mapped", and reusing it here would report every subpath as missing.
 * @param aliases - packages and the subpaths their `exports` publish.
 * @param text - the `tsconfig.base.json` content to read the mapped keys from.
 * @returns the unmapped `<package>/<subpath>` specifiers.
 */
export function uncoveredSubpaths(aliases: readonly PackageAlias[], text: string): string[] {
  const mapped = new Set<string>()
  for (const match of text.matchAll(/^\s*"(@deepseek-ai\/dsh-[^"]+)":/gm)) {
    const key = match[1]
    if (key !== undefined) mapped.add(key)
  }
  return aliases.flatMap(alias => alias.subpaths
    .map(subpath => `${alias.specifier}/${subpath}`)
    .filter(specifier => !mapped.has(specifier)))
}

/**
 * Render the generated region's alias lines.
 * @param aliases - packages to map, in emission order.
 * @param handWritten - specifiers already mapped outside the region; a duplicate key would shadow one silently.
 * @returns The region body, one JSON member per line.
 */
export function renderAliases(aliases: readonly PackageAlias[], handWritten: ReadonlySet<string>): string {
  const lines: string[] = []
  for (const alias of aliases) {
    if (!handWritten.has(alias.specifier)) {
      lines.push(`      ${JSON.stringify(alias.specifier)}: [${JSON.stringify(alias.source)}]`)
    }
    const invariant = `${alias.specifier}/invariant`
    if (alias.hasInvariant && !handWritten.has(invariant)) {
      lines.push(`      ${JSON.stringify(invariant)}: [${JSON.stringify(`${alias.source}/invariant.ts`)}]`)
    }
    for (const subpath of alias.subpaths) {
      const specifier = `${alias.specifier}/${subpath}`
      if (specifier === invariant || handWritten.has(specifier)) continue
      lines.push(`      ${JSON.stringify(specifier)}: [${JSON.stringify(`${alias.source}/${subpath}.ts`)}]`)
    }
  }
  // The region closes `paths`, so the last member carries no trailing comma.
  return lines.join(',\n')
}

/**
 * Replace the generated region of a config's text.
 * @param text - current `tsconfig.base.json` contents.
 * @param body - rendered alias lines.
 * @returns The updated contents.
 * @throws When the markers are missing or out of order.
 */
export function writeRegion(text: string, body: string): string {
  const begin = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (begin < 0 || end < begin) {
    throw new Error(`gen-tsconfig-paths: ${CONFIG} is missing the generated-region markers.`)
  }
  return `${text.slice(0, begin)}${BEGIN}\n${body}\n${END}${text.slice(end + END.length)}`
}

/**
 * Parse the config's `paths` keys, ignoring the generated region.
 * @param text - current `tsconfig.base.json` contents.
 * @returns Specifiers mapped by hand.
 */
function handWrittenSpecifiers(text: string): Set<string> {
  const begin = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  const outside = begin < 0 || end < begin ? text : text.slice(0, begin) + text.slice(end)
  const keys = new Set<string>()
  for (const match of outside.matchAll(/^\s*"(@deepseek-ai\/[^"]+)":/gm)) {
    const key = match[1]
    if (key !== undefined) keys.add(key)
  }
  return keys
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const check = process.argv.includes('--check')
  const current = readFileSync(CONFIG, 'utf8')
  const next = writeRegion(current, renderAliases(collectPackageAliases(), handWrittenSpecifiers(current)))
  const mapped = mappedSpecifiers(next)
  const uncoveredSubpath = uncoveredSubpaths(collectPackageAliases(), next)
  const uncovered = uncoveredPackages(collectPackageNames(), mapped)
  if (uncoveredSubpath.length > 0) {
    console.error(
      'gen-tsconfig-paths: no alias maps '
      + `${uncoveredSubpath.join(', ')}; a published subpath with no alias resolves to the package's `
      + 'built lib/ on the source plane, so tests silently measure an artifact instead of source.',
    )
    process.exitCode = 1
  } else if (uncovered.length > 0) {
    console.error(
      'gen-tsconfig-paths: no alias maps '
      + `${uncovered.join(', ')}; add a hand-written entry, because a package named after `
      + 'something other than its directory cannot be generated.',
    )
    process.exitCode = 1
  } else if (current === next) {
    console.log('gen-tsconfig-paths: tsconfig.base.json package aliases are current.')
  } else if (check) {
    console.error('gen-tsconfig-paths: tsconfig.base.json is stale; run `pnpm run gen-tsconfig-paths`.')
    process.exitCode = 1
  } else {
    writeFileSync(CONFIG, next)
    console.log('gen-tsconfig-paths: rewrote tsconfig.base.json package aliases.')
  }
}
