/**
 * Reproducible plugin locking: boot admission, tag-drift detection, and the
 * transactional install decision (Epic P1-03).
 *
 * @module @deepseek-ai/dsh-plugin-lock
 */

export {
  resolveLoadOrder,
  validateLock,
} from './types.ts'
export type {
  GrantedCapability,
  LockDefectReason,
  LockValidation,
  ManifestDigest,
  PackageIntegrity,
  PluginLockEntry,
  PluginLockFile,
  PluginPackageName,
  PluginVersion,
  SignatureIdentity,
  SourceCommit,
} from './types.ts'

import type {
  ManifestDigest,
  PackageIntegrity,
  PluginLockEntry,
  PluginLockFile,
  PluginPackageName,
  PluginVersion,
} from './types.ts'

/** What boot observes about one installed plugin on disk. */
export interface InstalledPlugin {
  readonly name: PluginPackageName
  readonly version: PluginVersion
  readonly integrity: PackageIntegrity
  readonly manifestDigest: ManifestDigest
}

/** Why boot refused to load a plugin. */
export type BootDenialReason =
  /** The plugin is installed but the lock does not list it. */
  | 'not-in-lock'
  /** The lock lists it, but nothing is installed. */
  | 'missing-from-disk'
  /** The installed archive's integrity digest differs from the lock's. */
  | 'integrity-mismatch'
  /** The installed manifest's digest differs from the lock's. */
  | 'manifest-digest-mismatch'
  /** The installed version differs from the locked one. */
  | 'version-mismatch'

/** One plugin boot refused, and why. */
export interface BootDenial {
  readonly name: PluginPackageName
  readonly reason: BootDenialReason
}

/** The outcome of deciding what a production boot may load. */
export type BootAdmission =
  | { readonly admitted: true; readonly loadOrder: readonly PluginPackageName[] }
  | { readonly admitted: false; readonly denials: readonly BootDenial[] }

/**
 * Decide what a production boot may load (must[2]).
 *
 * Fail-closed on the WHOLE boot rather than per plugin: a profile that loaded
 * everything except the one plugin whose digest drifted is a different
 * profile from the locked one, and silently running a subset is how a
 * compromised or corrupt install becomes a working system with a missing
 * feature nobody notices. Every denial is reported, not just the first,
 * because an operator repairing an install needs the whole list.
 *
 * Takes the installed set as data, so acceptance[0] — verifying a local cache
 * on an offline cold start — is the same call with no network-shaped
 * parameter to omit.
 * @param lock - the profile's lock.
 * @param installed - what is actually on disk.
 * @returns the load order to use, or every reason the boot is refused.
 */
export function admitBoot(lock: PluginLockFile, installed: readonly InstalledPlugin[]): BootAdmission {
  const onDisk = new Map(installed.map(plugin => [plugin.name, plugin]))
  const locked = new Set(lock.entries.map(entry => entry.name))
  const denials: BootDenial[] = []

  for (const plugin of installed) {
    if (!locked.has(plugin.name)) denials.push({ name: plugin.name, reason: 'not-in-lock' })
  }
  for (const entry of lock.entries) {
    const plugin = onDisk.get(entry.name)
    if (plugin === undefined) {
      denials.push({ name: entry.name, reason: 'missing-from-disk' })
      continue
    }
    if (plugin.version !== entry.version) {
      denials.push({ name: entry.name, reason: 'version-mismatch' })
    } else if (plugin.integrity !== entry.integrity) {
      denials.push({ name: entry.name, reason: 'integrity-mismatch' })
    } else if (plugin.manifestDigest !== entry.manifestDigest) {
      denials.push({ name: entry.name, reason: 'manifest-digest-mismatch' })
    }
  }

  if (denials.length > 0) return { admitted: false, denials }
  return { admitted: true, loadOrder: lock.loadOrder }
}

/**
 * Whether a registry's current answer for a locked plugin differs from what
 * the lock recorded (acceptance[1]).
 *
 * Reports drift; it does not act on it. A locked profile keeps loading the
 * locked version whatever the registry now says — that is what a lock is —
 * so the caller's only legitimate response is to tell someone, never to
 * follow the registry.
 * @param entry - the locked entry.
 * @param registryVersion - the version the registry resolves that name to now.
 * @returns whether the registry has moved away from the locked version.
 */
export function hasTagDrifted(entry: PluginLockEntry, registryVersion: PluginVersion): boolean {
  return entry.version !== registryVersion
}

/** Why a candidate lock was refused before replacing the current one. */
export type InstallRefusalReason =
  /** The candidate is internally inconsistent; `validateLock` names the defect. */
  | 'candidate-invalid'
  /** The current lock changed since the candidate was generated from it. */
  | 'concurrent-modification'

/** The outcome of a transactional install (must[1]). */
export type InstallDecision =
  | { readonly committed: true; readonly lock: PluginLockFile }
  | { readonly committed: false; readonly reason: InstallRefusalReason; readonly detail: string }
