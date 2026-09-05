/**
 * The transactional lock install: generate a candidate, verify it, replace
 * atomically (Epic P1-03 must[1], acceptance[2]).
 *
 * The order is the whole mechanism. A candidate is validated BEFORE it
 * replaces anything, so a rejected candidate leaves the working lock exactly
 * as it was — an install that fails half-way must leave the profile in the
 * state it started from, not in a third state neither version describes.
 *
 * @module @deepseek-ai/dsh-plugin-lock/commit
 */
import { renameSync, writeFileSync } from 'node:fs';
import { validateLock } from "./types.js";
/**
 * Serialize a lock to its canonical on-disk text.
 *
 * Two-space indentation and a trailing newline, with keys written in a fixed
 * order rather than whatever the object happens to carry: the file is
 * committed to a repository and diffed by people, and a serializer whose
 * output depended on property insertion order would produce spurious diffs
 * between machines that resolved the same graph.
 * @param lock - the lock to serialize.
 * @returns the exact bytes to write.
 */
export function serializeLock(lock) {
    const entries = lock.entries.map(entry => ({
        name: entry.name,
        version: entry.version,
        integrity: entry.integrity,
        sourceCommit: entry.sourceCommit,
        manifestDigest: entry.manifestDigest,
        signatureIdentity: entry.signatureIdentity,
        dependencies: [...entry.dependencies].sort(),
        grantedCapabilities: [...entry.grantedCapabilities].sort(),
    }));
    return `${JSON.stringify({ lockfileVersion: lock.lockfileVersion, entries, loadOrder: lock.loadOrder }, null, 2)}\n`;
}
/**
 * Decide whether a candidate lock may replace the current one (must[1]).
 *
 * `observedBase` is the lock the candidate was generated FROM. Comparing it
 * against `current` is what makes concurrent installs safe: two processes that
 * both read version 3 and both produce a candidate would otherwise each
 * replace the other's work, and the profile would end up describing one
 * install with the other's plugins. The second commit is refused instead, and
 * its caller must regenerate against the lock that actually landed.
 *
 * Validation runs before the concurrency check because an invalid candidate is
 * wrong regardless of what else happened — telling its author to regenerate
 * against a newer base would send them to fix the wrong thing.
 * @param current - the lock presently on disk.
 * @param candidate - the lock the install proposes.
 * @param observedBase - the lock the candidate was generated from.
 * @returns the committed lock, or the refusal and its detail.
 */
export function planLockCommit(current, candidate, observedBase) {
    const validation = validateLock(candidate);
    if (!validation.valid) {
        return { committed: false, reason: 'candidate-invalid', detail: `${validation.reason}: ${validation.detail}` };
    }
    if (serializeLock(current) !== serializeLock(observedBase)) {
        return {
            committed: false,
            reason: 'concurrent-modification',
            detail: 'the lock changed after this candidate was generated; regenerate against the current lock',
        };
    }
    return { committed: true, lock: candidate };
}
/**
 * Replace a lock file atomically (acceptance[2]).
 *
 * Writes a sibling temporary file and renames it over the target. `rename`
 * within one directory is atomic on POSIX and on Windows' NTFS, so a reader —
 * including a concurrent boot — observes either the whole old file or the
 * whole new one, never a partial write. Writing in place would expose a
 * truncated lock for as long as the write takes, and a boot landing in that
 * window would fail closed on a file that is not actually corrupt.
 *
 * The temporary name carries the process id so two concurrent installs do not
 * collide on the scratch file itself while racing for the rename.
 * @param path - the lock file's final path.
 * @param lock - the lock to write.
 */
export function writeLockAtomically(path, lock) {
    const scratch = `${path}.${process.pid}.tmp`;
    writeFileSync(scratch, serializeLock(lock), 'utf8');
    renameSync(scratch, path);
}
//# sourceMappingURL=commit.js.map