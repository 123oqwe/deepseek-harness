/**
 * Building a candidate lock from an observed install (Epic P1-03 must[1]).
 *
 * The generator records what it can OBSERVE and marks what it cannot. Some of
 * must[0]'s nine facts are readable from an installed package — its name, its
 * exact version, and a digest computed over its own manifest bytes. Others
 * (the archive's subresource integrity, the commit it was built from, the
 * identity that signed it) are properties of how the package was PUBLISHED,
 * and an installed directory does not carry them unless the package chose to
 * declare them.
 *
 * A generator that invented plausible values for the rest would produce a lock
 * that looks complete and verifies nothing — the failure this whole epic
 * exists to prevent, committed by the tool meant to prevent it. So an
 * unobservable fact is recorded as `unavailable:<reason>`, which is a value a
 * later comparison can still be exact about while a reader can see at a glance
 * that it pins nothing.
 *
 * @module @deepseek-ai/dsh-plugin-lock/candidate
 */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { resolveLoadOrder } from './types.ts'
import type {
  GrantedCapability,
  ManifestDigest,
  PackageIntegrity,
  PluginLockEntry,
  PluginLockFile,
  PluginPackageName,
  PluginVersion,
  SignatureIdentity,
  SourceCommit,
} from './types.ts'

/** The prefix marking a fact this install could not observe. */
export const UNAVAILABLE_PREFIX = 'unavailable:'

/**
 * Whether a recorded fact is a marker rather than an observation.
 *
 * Exported because a caller comparing two locks needs to distinguish "these
 * differ" from "neither ever knew", and because a reporting surface should be
 * able to say how much of a lock is real.
 * @param value - the recorded value to classify.
 * @returns true when the value marks an unobservable fact.
 */
export function isUnavailable(value: string): boolean {
  return value.startsWith(UNAVAILABLE_PREFIX)
}

/** One installed package as the generator observes it. */
export interface ObservedPackage {
  readonly name: string
  readonly version: string
  /** The package's manifest, exactly as read from disk. */
  readonly manifest: unknown
  /** Dependency names that are themselves locked plugins. */
  readonly dependencies: readonly string[]
  /** Capabilities the profile granted this plugin. */
  readonly grantedCapabilities: readonly string[]
  /** The archive integrity, when the installer recorded one. */
  readonly integrity?: string
  /** The source commit, when the package declares one. */
  readonly sourceCommit?: string
  /** The signing identity the package CLAIMS; never verified here. */
  readonly signatureIdentity?: string
}

/**
 * Compute a digest over one manifest's canonical serialization.
 *
 * Keys are sorted recursively before hashing, so two installs of the same
 * package produce the same digest whatever order their JSON happened to be
 * written in. Without that the digest would report drift for a reformat.
 * @param manifest - the manifest value to digest.
 * @returns the `sha256-` prefixed digest.
 */
export function computeManifestDigest(manifest: unknown): ManifestDigest {
  const canonical = JSON.stringify(sortDeep(manifest))
  return brandString<ManifestDigest>(`sha256-${createHash('sha256').update(canonical, 'utf8').digest('hex')}`)
}

/** Recursively sort object keys so serialization is order-independent. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value === null || typeof value !== 'object') return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortDeep((value as Record<string, unknown>)[key])
  }
  return sorted
}

/**
 * Build a candidate lock from an observed install.
 *
 * Entries are sorted by name and the load order is resolved from the
 * dependency graph, so the result is already in the canonical form
 * `validateLock` requires — a generator that emitted an invalid candidate
 * would push the failure to commit time, where the reason is harder to read.
 *
 * Dependencies naming packages outside `packages` are dropped rather than
 * recorded: a lock entry may only depend on another entry, and keeping an
 * external dependency would make every generated candidate invalid.
 * @param packages - the observed installed packages.
 * @returns the candidate lock, or `undefined` when the graph has a cycle.
 */
export function buildCandidateLock(packages: readonly ObservedPackage[]): PluginLockFile | undefined {
  const known = new Set(packages.map(observed => observed.name))
  const entries: PluginLockEntry[] = packages
    .map(observed => ({
      name: brandString<PluginPackageName>(observed.name),
      version: brandString<PluginVersion>(observed.version),
      integrity: brandString<PackageIntegrity>(
        observed.integrity ?? `${UNAVAILABLE_PREFIX}installer-recorded-no-integrity`,
      ),
      sourceCommit: brandString<SourceCommit>(
        observed.sourceCommit ?? `${UNAVAILABLE_PREFIX}package-declares-no-source-commit`,
      ),
      manifestDigest: computeManifestDigest(observed.manifest),
      signatureIdentity: brandString<SignatureIdentity>(
        observed.signatureIdentity ?? `${UNAVAILABLE_PREFIX}package-declares-no-signature-identity`,
      ),
      dependencies: [...observed.dependencies]
        .filter(dependency => known.has(dependency))
        .sort()
        .map(dependency => brandString<PluginPackageName>(dependency)),
      grantedCapabilities: [...observed.grantedCapabilities].sort().map(capability => brandString<GrantedCapability>(capability)),
    }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  const loadOrder = resolveLoadOrder(entries)
  if (loadOrder === undefined) return undefined
  return { lockfileVersion: 1, entries, loadOrder }
}

/**
 * How many of a lock's facts are observations rather than markers.
 *
 * A caller reporting on a lock needs this: a lock in which every integrity is
 * a marker is a real lock file that pins no archive, and saying "locked"
 * without saying that would overstate what the file guarantees.
 * @param lock - the lock to summarize.
 * @returns counts of observed and unavailable facts across every entry.
 */
export function summarizeLockCoverage(lock: PluginLockFile): { readonly observed: number; readonly unavailable: number } {
  let observed = 0
  let unavailable = 0
  for (const entry of lock.entries) {
    for (const fact of [entry.integrity, entry.sourceCommit, entry.manifestDigest, entry.signatureIdentity]) {
      if (isUnavailable(fact)) unavailable += 1
      else observed += 1
    }
  }
  return { observed, unavailable }
}
