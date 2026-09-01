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
 * No runtime invariant: `src/index.ts`'s `createTrustKernel` now constructs
 * and pins the one `TrustKernel` value, but the identity guarantee this
 * comment used to defer — its six capability members never change
 * reference identity for the process lifetime — is enforced structurally,
 * not by any event this package emits or mutable data it owns.
 * `ctx.provide('trustKernel', kernel)` runs exactly once, from
 * `apps/cli/src/profile-boot.ts`'s `prepare` closure, before any
 * config-tree entry mounts; Cordis's own `ReflectService.provide`
 * (`vendor/cordis/src/reflect.ts`) throws on a second call for the same
 * name, and this package's code never calls `ctx.set('trustKernel', ...)`
 * to reassign the pinned value. There is no recurring event stream or
 * mutable data this package owns to check the identity against — the
 * guarantee holds because of code this package does not write, which a
 * runtime check cannot positively verify without inventing an event
 * unrelated to any real relationship this package owns.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
