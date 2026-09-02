/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-plugin-manifest`.
 * @module @deepseek-ai/dsh-plugin-manifest/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-plugin-manifest'

/** Cordis companion plugin name. */
export const name = 'plugin-manifest-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this Contract-stage slice ships only the
 * `PluginManifestV2` type surface (`src/types.ts`) and pure validation
 * functions (`src/validate.ts`) — this package registers no Cordis service,
 * constructs no manifest value of its own, and owns no mutable data or
 * recurring event stream to check. A later P-stage slice's companion owns
 * the live check once a real reader/installer exists — for example, that
 * every declaration `packages/host/plugin-inventory` reports as
 * `'manifest-v2'` actually passed `validatePluginManifestV2`.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
