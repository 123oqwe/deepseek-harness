/**
 * STUB pending Trust Kernel Contract-stage implementation (RED milestone,
 * Epic P0-02 anti-cheat discipline). Replaced by the real, explained-empty
 * invariant companion in the immediately following commit.
 *
 * @module @deepseek-ai/dsh-trust-kernel/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'trust-kernel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = () => {
  throw new Error('not implemented')
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-trust-kernel', install))
