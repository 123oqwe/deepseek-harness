/**
 * Test-only config-tree entry for A-581 question 31 (a): a sentinel that, on a
 * real factory launch, records what the shipped saved-workflow loader loaded
 * and refused to the marker file its config names.
 *
 * It is a plain `.mjs` plugin (not `.ts`) so the BUILT dsh bin can load it
 * under plain Node in `lib` mode — observing on the factory launcher avoids the
 * src/lib module split that gives an in-process spec its own trust-anchor
 * registry (A-578's mechanism).
 *
 * The saved-workflow loader reads its directory asynchronously, so this does
 * NOT read at mount: it waits for the launcher's `appReady` (committed after
 * boot settles) and only then reads `ctx.get('savedWorkflows')`, so the marker
 * always carries the finished load. When no loader is mounted (today, before
 * B-698), `savedWorkflows` is absent and the marker records that.
 * @module tests/first100/fixtures/P4-09.saved-workflows-marker
 */

import { writeFileSync } from 'node:fs'

export const name = 'p4-09-saved-workflows-marker'

/**
 * On app-ready, write the saved-workflow load result to the marker.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ marker: string }} config - the marker file's absolute path.
 */
export function apply(ctx, config) {
  const record = () => {
    const saved = ctx.get('savedWorkflows')
    const result = saved === undefined
      ? { present: false }
      : {
        present: true,
        loaded: [...saved.loaded],
        refused: saved.refused.map((entry) => ({ name: entry.name, reason: entry.reason })),
      }
    writeFileSync(config.marker, JSON.stringify(result))
    // End the launch once the marker is written: a profile boot with no task
    // otherwise idles until killed. The marker write above is synchronous, so it
    // is on disk before the process exits.
    const exit = ctx.get('appExit')
    if (typeof exit === 'function') exit(0)
  }
  const ready = ctx.get('appReady')
  if (ready === undefined) record()
  else ready.onReady(record)
}
