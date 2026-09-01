/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-feature-gates`.
 * @module @deepseek-ai/dsh-feature-gates/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-feature-gates'

/** Cordis companion plugin name. */
export const name = 'feature-gates-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this Contract-stage slice's `src/index.ts` is
 * type-only -- no gate registry, decision event stream, or other mutable
 * data exists yet for an event/data relation to check. A later
 * Provider-stage slice that registers a live shadow/enforce decision stream
 * must replace this explanation with a check over that stream (for example:
 * a `'shadow'`-state gate's ACTUAL APPLIED result always matches the legacy
 * outcome the same request would have produced -- never the shadow-only
 * decision -- even when its recorded `FeatureGateShadowDecisionRecord` shows
 * the two disagree; must[1]/acceptance[0]).
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
