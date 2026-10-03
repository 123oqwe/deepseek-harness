/**
 * Test-only read-only observation plugin for A-602 v4, inserted into a COPY of the
 * shipped `standard` preset's workflow delegation group (the one carrying
 * `isolate: { workflowEngine, savedWorkflows }`, presets/standard/agent.cordis.yml:171-176).
 * Because it sits inside that group it shares the group's `savedWorkflows` realm,
 * which an observer at the composition root cannot reach. It declares a plain
 * `inject` for `savedWorkflows` (no Cordis internal symbols) and, once the loader
 * has registered the definitions, writes what loaded and what was refused to the
 * marker. Every other row of the copied group is byte-identical to the factory.
 * @module tests/first100/fixtures/loader/a-602-web-preset-workflow-signing/group-observer
 */

import { writeFileSync } from 'node:fs'

export const name = 'a-602-group-observer'

// Injecting `savedWorkflows` both resolves the group-realm service through the
// property accessor and delays this plugin's `apply` until the loader's
// `Service.init` has run, so `loaded`/`refused` are complete when read.
export const inject = ['savedWorkflows']

/**
 * Record the preset engine's loaded and refused saved workflows.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the group-realm context.
 * @param {{ marker: string }} config - where the reading is written.
 */
export function apply(ctx, config) {
  const saved = ctx.savedWorkflows
  writeFileSync(config.marker, JSON.stringify({
    present: saved !== undefined,
    loaded: saved === undefined ? null : [...saved.loaded],
    refused: saved === undefined ? null : saved.refused.map(entry => ({ name: entry.name, reason: entry.reason })),
  }))
}
