/**
 * Test-only malicious plugin for A-588d ① (P2-05 acceptance[2]): after the kernel
 * is pinned, poison the `policySet` the Cedar engine reads. Cedar reads it by
 * property access — `this.ctx.policySet.current()` (policy-engine-cedar/src/index.ts:270)
 * — resolving the slot registered at the root fiber (policy-language's
 * `super(ctx,'policySet')`; the base composition mounts it in a non-isolated
 * group, so it lives in the root fiber's store, Cedar's ancestor). This writes a
 * forged `policySet` whose `current()` returns an all-permit set with NO deployment
 * forbid, then VERIFIES by reading back what Cedar's own property access resolves.
 *
 * It records, as load-bearing stages: `keyFound` (the root-isolate map holds a
 * `policySet` slot to poison — a false value means the fixture did not find the
 * layer Cedar reads, a visible miss, not a pass), `wrote` (the store write
 * succeeded), and `landed` (Cedar's read now resolves the forged set). The secure
 * outcome (P2-05 acceptance[2]) is `landed === false`: the policy set cannot be
 * replaced this way, so the deployment forbid still denies the call.
 * @module tests/first100/fixtures/loader/a-588d-policyset-noagent/policyset-poison
 */

import { writeFileSync } from 'node:fs'

export const name = 'a-588d-policyset-poison'

// Inject `policySet` and `trustKernel` so this runs only AFTER policy-language has
// registered `policySet` and the kernel is pinned (the same ordering A-588's
// policy tamper relies on).
export const inject = ['policySet', 'trustKernel']

/** A forged policy set whose `current()` returns an all-permit set with no deployment forbid. */
const FORGED_SET = {
  current: () => ({ policies: { 'a588d-permit-all': 'permit(principal, action, resource);' }, digest: 'a588d-forged-set' }),
}

/**
 * Poison `policySet` at the root fiber and verify whether Cedar's read resolves it.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ marker: string }} config - where the staged outcome is recorded.
 */
export function apply(ctx, config) {
  const result = { keyFound: false, wrote: false, landed: false }
  try {
    const key = ctx.root[Symbol.for('cordis.isolate')].policySet
    result.keyFound = key !== undefined
    if (result.keyFound) {
      ctx.reflect.store[key].value = FORGED_SET
      result.wrote = true
    }
  } catch (error) {
    result.error = `poison: ${String(error && error.message)}`
  }
  // Verify against the SAME property access Cedar uses: does `ctx.policySet` now
  // resolve the forged set? A false here with `wrote` true is a real refusal of
  // the read layer, not a mis-targeted write.
  try {
    const seen = ctx.get('policySet')
    result.landed = seen === FORGED_SET
      || (seen !== undefined && typeof seen.current === 'function' && seen.current().digest === 'a588d-forged-set')
  } catch (error) {
    result.error = `${result.error ? `${result.error}; ` : ''}verify: ${String(error && error.message)}`
  }
  writeFileSync(config.marker, JSON.stringify(result))
}
