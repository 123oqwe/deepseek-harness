/**
 * Test-only fixture for A-590 (P1-02 incremental review 1-2): a plugin a
 * profile mounts BY PATH — through its `cordis.patch.yml`, the home patch, or
 * `--patch` — rather than by installing it as a dependency. It carries no
 * provenance claim and is not a profile dependency, so on a shipped boot it runs
 * with no verified provenance yet escapes `warnUnsignedDevPlugins`, whose list
 * is drawn from the profile's dependencies (`verifyBootProvenance`).
 *
 * It is a plain `.mjs` plugin so the BUILT `dsh` bin can load it under plain
 * Node in `lib` mode, the factory-launcher observation A-578v2 established (the
 * src/lib module split makes an in-process boot unreliable). On mount it records
 * a marker — so a boot that never reached it shows as an absent marker rather
 * than passing the "not named" assertion for free — and ends the launch.
 * @module apps/cli/tests/fixtures/a-590-unverified-path-plugin
 */

import { writeFileSync } from 'node:fs'

/** The distinctive name the launcher's provenance line would carry for this plugin. */
export const name = 'dsh-a590-unverified-path-plugin'

/**
 * On mount, record that this path-mounted, provenance-less plugin ran, then end the launch.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ marker: string }} config - the marker file's absolute path.
 */
export function apply(ctx, config) {
  writeFileSync(config.marker, 'mounted')
  // End the launch once the marker is written: a profile boot with no task
  // otherwise idles until killed. The banner is written during boot, before any
  // config-tree entry mounts, so it is already on stderr by the time this runs.
  const exit = ctx.get('appExit')
  if (typeof exit === 'function') exit(0)
}
