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
import type { BootAdmission, InstalledPlugin } from './index.ts';
import type { PluginLockFile, PluginPackageName } from './types.ts';
/** What a boot does with a profile that has no lock file. */
export type UnlockedProfilePolicy = 
/** Refuse the boot. must[2]'s literal reading: no lock, nothing approved. */
'refuse'
/** Proceed, and report that nothing was verified. For profiles predating locking. */
 | 'warn-and-proceed';
/** Why a boot was refused before any lock comparison happened. */
export type GateDenialReason = 'no-lock-file';
/** The outcome of gating one boot. */
export type GateOutcome = {
    readonly admitted: true;
    readonly loadOrder: readonly PluginPackageName[];
    readonly verified: boolean;
} | {
    readonly admitted: false;
    readonly gateReason: GateDenialReason;
} | {
    readonly admitted: false;
    readonly admission: BootAdmission;
};
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
export declare function gateProductionBoot(lock: PluginLockFile | undefined, installed: readonly InstalledPlugin[], policy: UnlockedProfilePolicy): GateOutcome;
//# sourceMappingURL=gate.d.ts.map