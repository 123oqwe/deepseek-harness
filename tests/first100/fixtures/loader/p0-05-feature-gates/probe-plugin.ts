/**
 * A plugin inserted with `--patch` into a shipped launch for BLOCKED-322's
 * case: when applied it writes what the launch provides as `featureGates` to
 * the file `A402_OUT` names, as `{ provided, gates }`, each gate reduced to
 * its id and resolved state.
 *
 * `runProfile` provides `featureGates` under a bare service name with no
 * `Context` typing (`apps/cli/src/profile-boot.ts`), so it is read here by
 * name.
 * @module tests/first100/fixtures/loader/p0-05-feature-gates/probe-plugin
 */

import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

/** Plugin name. */
export const name = 'a402-feature-gate-probe'

/** One resolution, as far as this probe reads it. */
interface Resolution {
  readonly gateId?: unknown
  readonly resolved?: { readonly value?: unknown }
}

/**
 * Record the launch's feature gates.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  const out = process.env.A402_OUT
  if (out === undefined) return
  const value = (ctx as unknown as { get(service: string): unknown }).get('featureGates')
  const gates = Array.isArray(value)
    ? (value as readonly Resolution[]).map(gate => ({ id: gate.gateId ?? null, state: gate.resolved?.value ?? null }))
    : null
  writeFileSync(out, `${JSON.stringify({ provided: value !== undefined, gates })}\n`)
}
