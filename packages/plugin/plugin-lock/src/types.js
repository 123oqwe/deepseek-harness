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
/**
 * Validate one lock's internal consistency.
 *
 * Checks run in a fixed order and stop at the first defect, because a lock
 * with a dangling dependency has no meaningful load order to check next —
 * reporting both would invite fixing the symptom.
 * @param lock - the lock to validate.
 * @returns valid, or the first defect with a human-readable detail.
 */
export function validateLock(lock) {
    const names = new Set();
    for (const entry of lock.entries) {
        if (names.has(entry.name)) {
            return { valid: false, reason: 'duplicate-entry', detail: entry.name };
        }
        names.add(entry.name);
    }
    const canonical = [...lock.entries].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    if (canonical.some((entry, index) => entry.name !== lock.entries[index]?.name)) {
        return { valid: false, reason: 'entries-not-canonical', detail: 'entries must be sorted by name' };
    }
    for (const entry of lock.entries) {
        for (const dependency of entry.dependencies) {
            if (!names.has(dependency)) {
                return { valid: false, reason: 'dangling-dependency', detail: `${entry.name} -> ${dependency}` };
            }
        }
    }
    if (lock.loadOrder.length !== lock.entries.length || lock.loadOrder.some(name => !names.has(name))) {
        return { valid: false, reason: 'load-order-mismatch', detail: 'loadOrder must list exactly the lock entries' };
    }
    const seen = new Set();
    const byName = new Map(lock.entries.map(entry => [entry.name, entry]));
    for (const name of lock.loadOrder) {
        if (seen.has(name)) {
            return { valid: false, reason: 'load-order-mismatch', detail: `${name} appears twice in loadOrder` };
        }
        for (const dependency of byName.get(name)?.dependencies ?? []) {
            if (!seen.has(dependency)) {
                return { valid: false, reason: 'load-order-violates-dependency', detail: `${name} before ${dependency}` };
            }
        }
        seen.add(name);
    }
    return { valid: true };
}
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
export function resolveLoadOrder(entries) {
    const byName = new Map(entries.map(entry => [entry.name, entry]));
    const ordered = [];
    const placed = new Set();
    const visiting = new Set();
    const visit = (name) => {
        if (placed.has(name))
            return true;
        if (visiting.has(name))
            return false;
        visiting.add(name);
        const dependencies = [...(byName.get(name)?.dependencies ?? [])].sort();
        for (const dependency of dependencies) {
            if (!visit(dependency))
                return false;
        }
        visiting.delete(name);
        placed.add(name);
        ordered.push(name);
        return true;
    };
    for (const name of [...byName.keys()].sort()) {
        if (!visit(name))
            return undefined;
    }
    return ordered;
}
//# sourceMappingURL=types.js.map