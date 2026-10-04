/**
 * Test-only read-only observation plugin for A-602 v5, inserted into a COPY of the
 * shipped `standard` preset's workflow delegation group (the one carrying
 * `isolate: { workflowEngine, savedWorkflows }`, presets/standard/agent.cordis.yml:171-176).
 * Because it sits inside that group it shares the group's `savedWorkflows` realm,
 * which an observer at the composition root cannot reach.
 *
 * v5: it does NOT inject `savedWorkflows`. v4 injected it, which delayed this
 * plugin's `apply` until the loader's `Service.init` had run — but `mountPreset`'s
 * `handle.await()` returns before those later-activated rows finish, so the
 * sentinel read the session as composed while this row was still "waiting for
 * savedWorkflows" (v4 red, a fixture-timing artefact, not a product defect). So
 * `apply` runs immediately at mount and POLLS the strict `ctx.get('savedWorkflows')`
 * within a bounded time: the loader registers the service at construction but fills
 * `loaded`/`refused` in `Service.init`, and that fill is one synchronous burst, so
 * the first read with any outcome is the complete one. A timeout records red and
 * is surfaced with the subprocess stderr.
 * @module tests/first100/fixtures/loader/a-602-web-preset-workflow-signing/group-observer
 */

import { writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

export const name = 'a-602-group-observer'

/** Poll interval and deadline for the group engine's `savedWorkflows` to publish its outcomes. */
const POLL_MS = 25
const DEADLINE_MS = 20_000

/**
 * Poll the group-realm `savedWorkflows` until it has published its load/refuse
 * outcomes, then record them; on timeout record red.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the group-realm context.
 * @param {{ marker: string }} config - where the reading is written.
 */
export function apply(ctx, config) {
  void (async () => {
    const started = Date.now()
    let saved
    while (Date.now() - started < DEADLINE_MS) {
      saved = ctx.get('savedWorkflows')
      // Present AND an outcome recorded: `Service.init` fills `loaded`/`refused`
      // in one synchronous burst after the (awaited) directory read, so any
      // non-empty count is the complete set.
      if (saved !== undefined && saved.loaded.length + saved.refused.length > 0) break
      await delay(POLL_MS)
    }
    if (saved === undefined || saved.loaded.length + saved.refused.length === 0) {
      writeFileSync(config.marker, JSON.stringify({ present: saved !== undefined, timedOut: true, waitedMs: Date.now() - started }))
      return
    }
    writeFileSync(config.marker, JSON.stringify({
      present: true,
      timedOut: false,
      loaded: [...saved.loaded],
      refused: saved.refused.map(entry => ({ name: entry.name, reason: entry.reason })),
      waitedMs: Date.now() - started,
    }))
  })()
}
