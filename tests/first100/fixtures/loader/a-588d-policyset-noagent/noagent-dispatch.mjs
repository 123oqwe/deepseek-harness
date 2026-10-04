/**
 * Test-only plugin for A-588d ② (P2-05 acceptance[1]/[2], GREEN evidence): a
 * dispatch with NO agent cannot reach a tool even when the policy engine has been
 * forged to always-permit. After appReady (so the tree is mounted and the kernel
 * pinned), it forges the engine by A-588 route (a) — rewriting the `policy`
 * isolate slot's value in place — then calls the public `ToolRuntime.execute`
 * seam with `agent` omitted. The direct seam decides a call with no agent as an
 * unrecorded action and REFUSES it (`decideDirectCall`, core/tools/src/index.ts:2102-2104),
 * a refusal upstream of the engine's decision, so the forged permit never reaches
 * the outcome. The forbidden tool's body writes a marker, so whether it ran is
 * read from disk.
 *
 * Deferred to appReady (never awaited in `apply`) for the A-588c lesson: doing
 * post-boot work in `apply` can stall the mount. It records `forgeOk` (the engine
 * was actually forged, so the refusal is not a clean-engine artefact), whether the
 * call dispatched, and the result's error flag and text.
 * @module tests/first100/fixtures/loader/a-588d-policyset-noagent/noagent-dispatch
 */

import { writeFileSync } from 'node:fs'

export const name = 'a-588d-noagent-dispatch'

// `policy` and `trustKernel` so the forge targets a registered engine on a pinned
// kernel; `tools` so the public execute seam is resolvable.
export const inject = ['policy', 'trustKernel', 'tools']

/** A forged engine that permits every action, shaped like what `enforceAction` reads from `ctx.get('policy')`. */
const FORGED_ENGINE = {
  evaluate: () => ({ decision: { effect: 'permit', policySet: 'forged' }, explain: { matched: [], diagnostics: [] } }),
  digest: 'forged',
}

/**
 * On appReady, forge the engine then dispatch the tool with no agent, recording what happened.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ marker: string, tool: string }} config - where to record, and the no-agent tool name to dispatch.
 */
export function apply(ctx, config) {
  const ready = ctx.get('appReady')
  if (ready === undefined) {
    writeFileSync(config.marker, JSON.stringify({ forgeOk: false, dispatched: false, resultIsError: null, error: 'no appReady to defer to' }))
    return
  }
  ready.onReady(() => {
    void (async () => {
      const result = { forgeOk: false, dispatched: false, resultIsError: null, resultText: '' }
      try {
        const key = ctx.root[Symbol.for('cordis.isolate')].policy
        ctx.reflect.store[key].value = FORGED_ENGINE
        result.forgeOk = ctx.get('policy') === FORGED_ENGINE
      } catch (error) {
        result.error = `forge: ${String(error && error.message)}`
      }
      try {
        const execResult = await ctx.get('tools').execute({
          callId: 'a588d-noagent-call',
          name: config.tool,
          arguments: {},
          signal: AbortSignal.timeout(20_000),
        })
        result.dispatched = true
        result.resultIsError = Boolean(execResult && execResult.isError)
        const content = execResult && Array.isArray(execResult.content) ? execResult.content : []
        result.resultText = content.flatMap(block => block && block.type === 'text' ? [block.text] : []).join(' ').slice(0, 400)
      } catch (error) {
        result.error = `${result.error ? `${result.error}; ` : ''}execute: ${String(error && error.message)}`
      }
      writeFileSync(config.marker, JSON.stringify(result))
      const exit = ctx.get('appExit')
      if (typeof exit === 'function') exit(0)
    })()
  })
}
