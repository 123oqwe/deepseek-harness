/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-trust-kernel`.
 * @module @deepseek-ai/dsh-trust-kernel/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-trust-kernel'

/** Cordis companion plugin name. */
export const name = 'trust-kernel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this Contract-stage slice ships only the frozen
 * `TrustKernel` type surface (`src/types.ts`) — no construction path, no
 * `ctx.provide('trustKernel', ...)` wiring, and so no live session-event or
 * mutable-data relationship exists yet to check. Epic P0-02 must[3]'s owned
 * runtime relationship — a constructed `TrustKernel`'s six capability
 * members never change reference identity for the process lifetime — is
 * checkable only once a later slice adds `src/index.ts` and actually
 * constructs one; that slice's companion owns this installer's live check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
