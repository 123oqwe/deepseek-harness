/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-principal`.
 * @module @deepseek-ai/dsh-principal/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-principal'

/** Cordis companion plugin name. */
export const name = 'principal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a pure type contract and pure
 * delegation-chain functions, with no event stream or mutable module state
 * to compare (the `adminGrants` registry in `./chain.ts` is a private
 * unforgeability check, not a public relation).
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
