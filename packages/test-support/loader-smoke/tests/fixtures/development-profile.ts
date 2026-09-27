/**
 * Declare a {@link bootProductionProfile} composition an explicit development
 * profile (Epic P0-02 acceptance[2]).
 *
 * A driver that dispatches tools on a shipped composition without pinning a
 * Trust Kernel would otherwise have every dispatch refused (a policy engine is
 * mounted, no kernel is pinned). Declaring the development profile leaves the
 * dispatch unenforced, exactly as it ran before this epic — the
 * behavior-preserving migration. Pinning a Trust Kernel instead would open the
 * policy and approval gates and change what the driver observes.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import { DEVELOPMENT_PROFILE_KEY } from '@deepseek-ai/dsh-policy-enforcement'

/**
 * Publish the development-profile launch fact before any config-tree entry
 * mounts. Pass as `bootProductionProfile`'s `prepare`.
 * @param ctx - the context `bootProductionProfile` is about to mount the tree on.
 */
export function declareDevelopmentProfile(ctx: Context): void {
  ctx.provide(DEVELOPMENT_PROFILE_KEY, true)
}
