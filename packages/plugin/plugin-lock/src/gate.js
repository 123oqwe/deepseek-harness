/**
 * The production-boot lock gate (Epic P1-03 must[2]).
 *
 * `admitBoot` decides what a boot may load GIVEN a lock. This module answers
 * the question that comes first: what happens when a profile has no lock at
 * all.
 *
 * That is a deployment choice, not a fact this package can derive, so it is a
 * required parameter rather than a default hidden inside the check. Nothing
 * in this repository generates a lock yet, so a gate that silently refused an
 * unlocked profile would break every existing boot, and one that silently
 * admitted it would let must[2] read as satisfied while enforcing nothing.
 * Making the caller state its policy is what keeps either outcome from being
 * an accident.
 *
 * @module @deepseek-ai/dsh-plugin-lock/gate
 */
import { admitBoot } from "./index.js";
/**
 * Gate one production boot against its profile's lock.
 *
 * When a lock exists the decision is `admitBoot`'s and nothing here softens
 * it. When none exists the caller's policy decides, and the admitted result
 * carries `verified: false` so a caller cannot mistake an unlocked boot for a
 * checked one — the two must stay distinguishable at the call site, since
 * "loaded successfully" would otherwise mean two different things.
 * @param lock - the profile's lock, or `undefined` when it has none.
 * @param installed - the plugins actually present.
 * @param policy - what to do with an unlocked profile.
 * @returns the load order to use, or the refusal.
 */
export function gateProductionBoot(lock, installed, policy) {
    if (lock === undefined) {
        if (policy === 'refuse')
            return { admitted: false, gateReason: 'no-lock-file' };
        return { admitted: true, loadOrder: installed.map(plugin => plugin.name), verified: false };
    }
    const admission = admitBoot(lock, installed);
    if (!admission.admitted)
        return { admitted: false, admission };
    return { admitted: true, loadOrder: admission.loadOrder, verified: true };
}
//# sourceMappingURL=gate.js.map