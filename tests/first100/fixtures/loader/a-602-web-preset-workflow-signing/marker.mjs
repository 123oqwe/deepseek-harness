/**
 * Test-only root sentinel for A-602 (P4-09 acceptance[0] on a Web preset, blind
 * review 2-6): the shipped base mounts no saved-workflow loader; the Web app
 * runs each session on the engine inside its preset's `isolate: workflowEngine`
 * delegation group, where `workflow-filesystem` loads `$DSH_HOME/workflows` and
 * registers a definition only when the signature beside it verifies against the
 * profile's offline-signed `dsh.trustAnchors`. That per-preset engine has only
 * ever been STRUCTURALLY checked, never observed loading and refusing.
 *
 * Mounted at the composition root (not inside a preset), it waits for `appReady`
 * then creates ONE session composed from the factory `standard` preset the SAME
 * way the Web session controller does (`ctx.agents.create({ setup:
 * agentPresets.mount(...) })`, packages/api/session-controller/src/agent.ts:481-490),
 * reads the preset-isolate engine's `savedWorkflows` through that session's agent
 * context (`handle.agent.ctx.get('savedWorkflows')`, as web-agent-presets.e2e.ts
 * reads preset-isolate services), writes the result to the marker, and ends the
 * launch. The preset file is the factory `standard` unchanged, so what this
 * observes is the shipped preset engine.
 * @module tests/first100/fixtures/loader/a-602-web-preset-workflow-signing/marker
 */

import { writeFileSync } from 'node:fs'

export const name = 'a-602-web-preset-workflow-marker'

/**
 * On `appReady`, compose a `standard` session, read its preset engine's saved
 * workflows, and record them.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the composition root context.
 * @param {{ marker: string }} config - where to write the reading.
 */
export function apply(ctx, config) {
  // The disabled `connection` row would otherwise leave its dependents
  // (session-controller, client-file-upload, client-ui-deliverables) waiting
  // forever, so provide the same in-process stub web-agent-presets.e2e.ts does:
  // the agent plane loads without a bound HTTP port.
  ctx.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } })
  const ready = ctx.get('appReady')
  if (ready === undefined) {
    writeFileSync(config.marker, JSON.stringify({ sessionCreated: false, present: false, reason: 'no appReady' }))
    return
  }
  ready.onReady(async () => {
    let reading
    try {
      const handle = await ctx.agents.create({
        sessionId: 'a602-web-preset-session',
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
      })
      const saved = handle.agent.ctx.get('savedWorkflows')
      reading = {
        sessionCreated: true,
        present: saved !== undefined,
        loaded: saved === undefined ? null : [...saved.loaded],
        refused: saved === undefined ? null : saved.refused.map(entry => ({ name: entry.name, reason: entry.reason })),
      }
    } catch (error) {
      reading = { sessionCreated: false, present: false, error: error instanceof Error ? error.message : String(error) }
    }
    writeFileSync(config.marker, JSON.stringify(reading))
    const exit = ctx.get('appExit')
    if (typeof exit === 'function') exit(0)
  })
}
