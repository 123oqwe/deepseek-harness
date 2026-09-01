/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-evidence-format`.
 * @module @deepseek-ai/dsh-evidence-format/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-evidence-format'

/** Cordis companion plugin name. */
export const name = 'evidence-format-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this Contract-stage slice ships only the
 * `EvidencePackage`/`GateEvidence` type surface (`src/types.ts`) — no
 * `collect-evidence.mjs` producer or `verify-evidence.mjs` verifier exists
 * yet (Epic P0-07's P-stage), this package registers no Cordis service, and
 * it owns no mutable data or recurring event stream of its own to check.
 * A later P-stage slice's companion owns the live check once a real
 * producer exists — for example, that every `AcceptedEvidencePackage` a
 * collector run actually emits verifies its own `signature` before being
 * written to disk.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
