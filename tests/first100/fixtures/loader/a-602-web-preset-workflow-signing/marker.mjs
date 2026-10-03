/**
 * Test-only root sentinel for A-602 v4 (P4-09 acceptance[0] on a Web preset, blind
 * review 2-6): the Web app runs each session on the workflow engine inside its
 * preset's `isolate: { workflowEngine, savedWorkflows }` delegation group
 * (presets/standard/agent.cordis.yml:171-176), which an observer at the
 * composition root cannot reach. So this root plugin only COMPOSES a session —
 * the SAME way the Web session controller does (`ctx.agents.create({ setup:
 * agentPresets.mount(...) })`, packages/api/session-controller/src/agent.ts:481-490)
 * — from a copy of the shipped `standard` that carries a read-only observer INSIDE
 * that group; the observer, sharing the group's realm, is what reads
 * `savedWorkflows` and writes its marker. This sentinel records only whether the
 * session was composed.
 * @module tests/first100/fixtures/loader/a-602-web-preset-workflow-signing/marker
 */

import { writeFileSync } from 'node:fs'

export const name = 'a-602-web-preset-workflow-marker'

// `ctx.agents` / `ctx.agentPresets` are topology-sensitive property accessors and
// require a declared injection (packages/AGENTS.md).
export const inject = ['agents', 'agentPresets']

/**
 * On `appReady`, compose a session from the observed preset copy and record it.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the composition root context.
 * @param {{ marker: string, preset: string }} config - where to record, and the preset id to compose.
 */
export function apply(ctx, config) {
  // The disabled `connection` row would leave session-controller and its kin
  // waiting; provide the same in-process stub web-agent-presets.e2e.ts does so the
  // agent plane loads without a bound HTTP port.
  ctx.provide('connection', { fetch: { register: () => () => {} }, rpc: { intercept: () => () => {} } })
  const ready = ctx.get('appReady')
  if (ready === undefined) {
    writeFileSync(config.marker, JSON.stringify({ sessionCreated: false, reason: 'no appReady' }))
    return
  }
  ready.onReady(async () => {
    let reading
    try {
      await ctx.agents.create({
        sessionId: 'a602-web-preset-session',
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, config.preset).then(() => undefined),
      })
      reading = { sessionCreated: true }
    } catch (error) {
      reading = { sessionCreated: false, error: error instanceof Error ? error.message : String(error) }
    }
    writeFileSync(config.marker, JSON.stringify(reading))
    const exit = ctx.get('appExit')
    if (typeof exit === 'function') exit(0)
  })
}
