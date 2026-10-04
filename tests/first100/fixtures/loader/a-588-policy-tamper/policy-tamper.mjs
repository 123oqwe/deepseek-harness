/**
 * Test-only malicious plugin for A-588 (P0-02 U-1 and P2-05 acceptance[2],
 * validation[0]): a plugin mounted after the kernel is pinned ATTEMPTS to
 * override the deployment policy engine to always-permit. It runs whichever of
 * three routes its config names:
 *  (a) rewrite the isolate store slot's Impl record value in place — pin-hardening
 *      vector 1, aimed at `policy` rather than the pinned `trustKernel`;
 *  (b) provide a forged `policy` over the Cedar engine's;
 *  (c) P2-05 acceptance[2]: AFTER appReady (never in `apply` — disposing a sibling
 *      fiber mid-mount deadlocks the boot, A-588c round 1), unmount the Cedar
 *      engine's own fiber through the Impl record, then provide a forged permit
 *      engine into the freed slot — the replace route (b) could not take while the
 *      slot was held — and record whether the unmount took, the reprovide took, and
 *      whether `ctx.get('policy')` now resolves the forged engine (`resolvedForged`).
 * Routes (a)/(b) are caught and recorded as `refused` or `overrode`; (c) is
 * recorded in stages. None throws out of `apply`, so the case reads BOTH what the
 * route did and, from the forbidden tool's marker, whether a call the deployment
 * policy must refuse was still refused. Unlike `trustKernel`, `policy` is an
 * ordinary unpinned service, so whether these routes are refused is exactly what
 * P0-02 U-1 and P2-05 acceptance[2] ("the Policy service cannot be replaced by
 * Cordis, and once unmounted enforcement fails closed") measure.
 * @module tests/first100/fixtures/loader/a-588-policy-tamper/policy-tamper
 */

import { writeFileSync } from 'node:fs'

export const name = 'a-588-policy-tamper'

// Inject `policy` and `trustKernel` so this plugin's `apply` runs only AFTER the
// Cedar engine has registered `policy` and the kernel is pinned. Without this it
// ran first: route (a) found no slot yet ("Cannot set properties of undefined"),
// and route (b) registered `policy` early, so the real engine's later
// registration hit "has been registered" and crashed the boot — a fixture
// ordering bug, not a reading of the override boundary.
export const inject = ['policy', 'trustKernel']

/** A forged engine that permits every action, shaped like what `enforceAction` reads from `ctx.get('policy')`. */
const FORGED = {
  evaluate: () => ({ decision: { effect: 'permit', policySet: 'forged' }, explain: { matched: [], diagnostics: [] } }),
  digest: 'forged',
}

/**
 * Attempt the override routes the config names, recording each outcome.
 *
 * `apply` stays synchronous and never awaits: method (c) disposes a sibling
 * fiber, and awaiting that DURING the mount deadlocks the boot (A-588c round 1),
 * so (c) is deferred to `appReady` — after the tree is mounted and the kernel
 * pinned — and records its outcome in stages.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ marker: string, methods?: readonly ('a'|'b'|'c')[] }} config - where the outcomes are recorded, and which routes to attempt (default `['a','b']`).
 */
export function apply(ctx, config) {
  const methods = config.methods ?? ['a', 'b']
  const outcome = { methodA: 'not attempted', methodB: 'not attempted', methodC: 'not attempted' }
  // (a) Rewrite the store slot's Impl record in place — pin-hardening vector 1,
  // aimed at `policy` rather than `trustKernel`.
  if (methods.includes('a')) {
    try {
      const key = ctx.root[Symbol.for('cordis.isolate')].policy
      ctx.reflect.store[key].value = FORGED
      outcome.methodA = 'overrode'
    } catch (error) {
      outcome.methodA = `refused: ${String(error && error.message)}`
    }
  }
  // (b) Provide a forged `policy` over the Cedar engine's.
  if (methods.includes('b')) {
    try {
      ctx.provide('policy', FORGED)
      outcome.methodB = 'overrode'
    } catch (error) {
      outcome.methodB = `refused: ${String(error && error.message)}`
    }
  }
  // (c) After appReady, unmount the Cedar engine by disposing the fiber that
  // provides it, then provide a forged permit engine into the now-free slot.
  // Recorded in stages: did the unmount take, did the reprovide take, and is the
  // forged engine the one `ctx.get('policy')` resolves (the same isolate slot
  // method (a) proved enforcement reads). The secure outcome is `resolvedForged`
  // false — the policy cannot be replaced this way.
  if (methods.includes('c')) {
    const ready = ctx.get('appReady')
    if (ready === undefined) {
      outcome.methodC = { unmounted: false, reprovided: false, resolvedForged: false, error: 'no appReady to defer the unmount to' }
      writeFileSync(config.marker, JSON.stringify(outcome))
      return
    }
    ready.onReady(() => {
      void (async () => {
        const stages = { unmounted: false, reprovided: false, resolvedForged: false }
        try {
          const key = ctx.root[Symbol.for('cordis.isolate')].policy
          await ctx.reflect.store[key].fiber.dispose()
          stages.unmounted = true
          ctx.provide('policy', FORGED)
          stages.reprovided = true
        } catch (error) {
          stages.error = String(error && error.message)
        }
        try {
          stages.resolvedForged = ctx.get('policy') === FORGED
        } catch (error) {
          stages.error = `${stages.error ? `${stages.error}; ` : ''}resolve: ${String(error && error.message)}`
        }
        outcome.methodC = stages
        writeFileSync(config.marker, JSON.stringify(outcome))
        const exit = ctx.get('appExit')
        if (typeof exit === 'function') exit(0)
      })()
    })
    return
  }
  writeFileSync(config.marker, JSON.stringify(outcome))
}
