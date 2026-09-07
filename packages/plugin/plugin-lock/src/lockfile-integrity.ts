/**
 * The installer's recorded integrity for each package in a profile, read from
 * the profile's own `pnpm-lock.yaml`.
 *
 * **Why this exists.** The lock previously took integrity from a
 * `dsh.provenance.integrity` field on each installed package's `package.json`.
 * Nothing in this repository — or in npm or pnpm — ever writes that field, so
 * every entry fell back to the `unavailable:` marker, the boot recomputed the
 * same marker, and the comparison could not fail whatever happened to an
 * installed package (BLOCKED-135). The authoritative record is the lockfile,
 * which pnpm writes on every install and which is already on disk beside the
 * profile.
 *
 * Read through `@pnpm/lockfile.fs` rather than by parsing YAML here: the
 * lockfile's shape is pnpm's to change, and a hand-rolled reader would drift
 * silently the next time it does. Integrity strings are parsed with `ssri`
 * rather than compared as text, because `sha512-…` is a format with an
 * algorithm and an encoding, and string equality is only accidentally correct
 * while both stay fixed.
 *
 * @module @deepseek-ai/dsh-plugin-lock/lockfile-integrity
 */
import { readWantedLockfile } from '@pnpm/lockfile.fs'
import type { PackageSnapshots } from '@pnpm/lockfile.fs'
import ssri from 'ssri'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PackageIntegrity, PluginPackageName } from './types.ts'

/** How a package's integrity was established, so an absent one cannot pass as observed. */
export type IntegritySource =
  /** Read from the profile's pnpm-lock.yaml. */
  | 'lockfile'
  /** The package resolves to a workspace directory, which has no published archive to hash. */
  | 'workspace-link'

/** One package's recorded integrity and where it came from. */
export interface ObservedIntegrity {
  readonly integrity: PackageIntegrity
  readonly source: IntegritySource
}

/**
 * Read the recorded integrity of every package in a profile's lockfile.
 *
 * A workspace link has no archive and therefore no integrity; it is reported
 * with `source: 'workspace-link'` rather than omitted, so a caller can tell
 * "this package legitimately has none" from "this package is missing", which
 * is the distinction the `unavailable:` marker used to blur.
 * @param profileDir - the profile directory holding `pnpm-lock.yaml`.
 * @returns integrity by package name; empty when the profile has no lockfile.
 */
export async function readLockfileIntegrity(profileDir: string): Promise<Map<PluginPackageName, ObservedIntegrity>> {
  const lockfile = await readWantedLockfile(profileDir, { ignoreIncompatible: false })
  const observed = new Map<PluginPackageName, ObservedIntegrity>()
  if (lockfile === null) return observed

  for (const importer of Object.values(lockfile.importers)) {
    const declared: Record<string, { version: string } | string> = {
      ...importer.dependencies,
      ...importer.devDependencies,
    }
    for (const [name, spec] of Object.entries(declared)) {
      const version = typeof spec === 'string' ? spec : spec.version
      if (version.startsWith('link:')) {
        observed.set(brandString<PluginPackageName>(name), {
          integrity: brandString<PackageIntegrity>(`${WORKSPACE_LINK_PREFIX}${version.slice('link:'.length)}`),
          source: 'workspace-link',
        })
        continue
      }
      const recorded = integrityOf(lockfile.packages, name, version)
      if (recorded !== undefined) {
        observed.set(brandString<PluginPackageName>(name), { integrity: recorded, source: 'lockfile' })
      }
    }
  }
  return observed
}

/** The prefix marking an integrity that is a workspace path rather than a hash. */
export const WORKSPACE_LINK_PREFIX = 'workspace-link:'

/**
 * The integrity recorded for one resolved package, validated as a real SRI
 * string rather than trusted as text.
 * @param packages - the lockfile's resolved-package table.
 * @param name - the package name.
 * @param version - the resolved version as the importer records it.
 * @returns the integrity, or undefined when the lockfile records none.
 */
function integrityOf(packages: PackageSnapshots | undefined, name: string, version: string): PackageIntegrity | undefined {
  // `PackageSnapshots` is a mapped type over depPath keys, so an arbitrary
  // `name@version` string cannot index it directly; the table is read as a
  // plain record for this lookup and the value is narrowed straight after.
  const table = packages as unknown as Record<string, { resolution?: { integrity?: string } } | undefined> | undefined
  const entry = table?.[`${name}@${version}`]
  const recorded = entry?.resolution?.integrity
  if (recorded === undefined) return undefined
  // `ssri.parse` throws on a malformed value and returns an object whose
  // `toString()` is the canonical spelling. Comparing canonical forms means a
  // re-encoded but identical hash matches, and a corrupt one is rejected here
  // rather than mismatching later for the wrong reason.
  return brandString<PackageIntegrity>(ssri.parse(recorded, { single: true }).toString())
}
