/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-schema-registry`.
 * @module @deepseek-ai/dsh-schema-registry/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-schema-registry'

/** Cordis companion plugin name. */
export const name = 'schema-registry-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: `registerSchema`/`evolveSchema` enforce duplicate-id
 * rejection, version-bump-vs-declared-change-kind matching, and append-only
 * `history` synchronously inside the same call that mutates the private
 * registry map, with no independent event or second data source whose drift
 * a companion could detect (the same reasoning `@deepseek-ai/dsh-typert-registry`
 * and `@deepseek-ai/dsh-session-projection` give for their own registries).
 * `negotiateSchema`/`getSchema`/`listSchemas` are pure reads of that map and
 * assert nothing.
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
