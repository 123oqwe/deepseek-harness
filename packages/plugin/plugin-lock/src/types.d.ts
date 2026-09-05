/**
 * The reproducible plugin lock file and its resolution rules (Epic P1-03).
 *
 * A lock exists so that two installs of the same profile, on different
 * machines and at different times, load byte-identical plugins. Everything
 * here follows from that: the lock records what was resolved rather than what
 * was requested, boot compares against the lock rather than against a
 * registry, and a registry that later moves a tag cannot change what a locked
 * profile loads.
 *
 * **What this module does NOT do.** `signatureIdentity` is RECORDED, never
 * verified. Recording who claims to have signed something and deciding
 * whether that claim is trustworthy are different obligations, and only the
 * first belongs here — the second is `@deepseek-ai/dsh-plugin-provenance`'s,
 * and today it cannot be met: `verifyPackageSignature` trusts a first-seen
 * issuer, so the identity a lock records is an unverified self-assertion.
 * Nothing in this package may be read as evidence that a locked plugin's
 * signature is genuine (P1-02's acceptance lock).
 *
 * @module @deepseek-ai/dsh-plugin-lock/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
/** A plugin package name as it appears in a registry. */
export type PluginPackageName = Branded<'PluginPackageName'>
/** An exact resolved version; never a range, and never a tag. */
export type PluginVersion = Branded<'PluginVersion'>
/** A subresource-integrity digest of the resolved package archive. */
export type PackageIntegrity = Branded<'PackageIntegrity'>
/** The commit the package was built from. */
export type SourceCommit = Branded<'SourceCommit'>
/** A digest over the plugin's manifest, separate from the archive's. */
export type ManifestDigest = Branded<'ManifestDigest'>
/**
 * Who the package claims signed it.
 *
 * A recorded claim, not a verified fact. Kept in the lock so drift in the
 * claim is detectable across resolutions; whether the claim is true is
 * decided elsewhere, and today by nothing.
 */
export type SignatureIdentity = Branded<'SignatureIdentity'>
/** A capability a plugin was granted at lock time. */
export type GrantedCapability = Branded<'GrantedCapability'>
/**
 * One locked plugin, carrying every fact must[0] enumerates.
 *
 * All nine are required rather than optional. An optional field would let a
 * lock omit, say, the manifest digest and still validate, and a lock that
 * validates while recording less than it claims to is worse than no lock —
 * it reports reproducibility it cannot deliver.
 */
export interface PluginLockEntry {
  readonly name: PluginPackageName
  readonly version: PluginVersion
  readonly integrity: PackageIntegrity
  readonly sourceCommit: SourceCommit
  readonly manifestDigest: ManifestDigest
  readonly signatureIdentity: SignatureIdentity
  /** Names this plugin depends on; every one must also be an entry. */
  readonly dependencies: readonly PluginPackageName[]
  /** Capabilities granted at lock time, sorted, so the lock is byte-stable. */
  readonly grantedCapabilities: readonly GrantedCapability[]
}
/** A complete lock file for one profile. */
export interface PluginLockFile {
  /** Bumped only when the on-disk structure changes; not a content version. */
  readonly lockfileVersion: number
  /** Entries in canonical order: sorted by name, so the file is byte-stable. */
  readonly entries: readonly PluginLockEntry[]
  /** The resolved load order, which dependencies alone do not determine. */
  readonly loadOrder: readonly PluginPackageName[]
}
/** Why a lock was rejected. */
export type LockDefectReason =
/** An entry depends on a name the lock does not contain. */
'dangling-dependency'
/** The dependency graph contains a cycle, so no load order exists. */
 | 'dependency-cycle'
/** `loadOrder` does not list exactly the lock's entries. */
 | 'load-order-mismatch'
/** `loadOrder` places a plugin before something it depends on. */
 | 'load-order-violates-dependency'
/** Two entries share a name. */
 | 'duplicate-entry'
/** Entries are not in canonical (sorted) order, so the file is not byte-stable. */
 | 'entries-not-canonical'
/** The outcome of validating a lock's internal consistency. */
export type LockValidation = {
  readonly valid: true
} | {
  readonly valid: false
  readonly reason: LockDefectReason
  readonly detail: string
}
/**
 * Validate one lock's internal consistency.
 *
 * Checks run in a fixed order and stop at the first defect, because a lock
 * with a dangling dependency has no meaningful load order to check next —
 * reporting both would invite fixing the symptom.
 * @param lock - the lock to validate.
 * @returns valid, or the first defect with a human-readable detail.
 */
export declare function validateLock(lock: PluginLockFile): LockValidation
/**
 * Resolve a load order from the entries' dependency graph.
 *
 * Ties are broken by name so the result is TOTAL: a graph where two plugins
 * are mutually independent admits several topological orders, and picking
 * whichever the traversal reached first would make the lock depend on map
 * iteration. Two machines resolving the same graph must write the same file.
 * @param entries - the entries to order.
 * @returns the load order, or `undefined` when the graph contains a cycle.
 */
export declare function resolveLoadOrder(entries: readonly PluginLockEntry[]): readonly PluginPackageName[] | undefined
//# sourceMappingURL=types.d.ts.map
