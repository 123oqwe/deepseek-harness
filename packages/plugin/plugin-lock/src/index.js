/**
 * Reproducible plugin locking: boot admission, tag-drift detection, and the
 * transactional install decision (Epic P1-03).
 *
 * @module @deepseek-ai/dsh-plugin-lock
 */
export { resolveLoadOrder, validateLock, } from "./types.js";
export { planLockCommit, serializeLock, writeLockAtomically } from "./commit.js";
export { gateProductionBoot } from "./gate.js";
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
export function admitBoot(lock, installed) {
    const onDisk = new Map(installed.map(plugin => [plugin.name, plugin]));
    const locked = new Set(lock.entries.map(entry => entry.name));
    const denials = [];
    for (const plugin of installed) {
        if (!locked.has(plugin.name))
            denials.push({ name: plugin.name, reason: 'not-in-lock' });
    }
    for (const entry of lock.entries) {
        const plugin = onDisk.get(entry.name);
        if (plugin === undefined) {
            denials.push({ name: entry.name, reason: 'missing-from-disk' });
            continue;
        }
        if (plugin.version !== entry.version) {
            denials.push({ name: entry.name, reason: 'version-mismatch' });
        }
        else if (plugin.integrity !== entry.integrity) {
            denials.push({ name: entry.name, reason: 'integrity-mismatch' });
        }
        else if (plugin.manifestDigest !== entry.manifestDigest) {
            denials.push({ name: entry.name, reason: 'manifest-digest-mismatch' });
        }
    }
    if (denials.length > 0)
        return { admitted: false, denials };
    return { admitted: true, loadOrder: lock.loadOrder };
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
export function hasTagDrifted(entry, registryVersion) {
    return entry.version !== registryVersion;
}
//# sourceMappingURL=index.js.map