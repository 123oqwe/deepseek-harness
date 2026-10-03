/**
 * P1-02 must[4] / question 30 (b), incremental review 1-2 (A-590): on a
 * non-development profile, a plugin mounted BY PATH — through the profile's own
 * `cordis.patch.yml`, the home patch, or `--patch` — runs with no verified
 * provenance and must be named every boot in the launcher's "plugins with no
 * verified provenance" line, exactly as an installed unverified plugin is; the
 * factory bundle's own packages, which are the product, are not named.
 *
 * Red first for B-707 (§21.4: the fix is not read). B-695's banner
 * (`warnUnsignedDevPlugins`) draws its list from `provenance.records`, and those
 * records come from `verifyBootProvenance(profileManifest.dependencies, …)` —
 * the profile's DEPENDENCIES. A plugin inserted by a patch row is a config-tree
 * entry, not a dependency, so it is never in the records, never in the
 * `unverified` list, and (with no other unverified dependency) the banner is not
 * printed at all — the path-mounted plugin escapes the warning while running
 * unverified. B-707 adds path-mounted plugins to the list.
 *
 * Observed on the FACTORY LAUNCHER (the built `dsh` bin in `lib` mode, as a
 * subprocess), the A-578v2 observation: the src/lib module split makes an
 * in-process boot resolve a different provenance instance than the launcher. A
 * test-only `.mjs` plugin is inserted by the profile's own patch layer, records
 * a marker on mount (the harness guard that it really ran), and ends the launch;
 * the launch's stderr is read for the banner.
 *
 * Today the path-mounted plugin is not named — RED — while the control (no
 * bundle package named) holds; B-707 names it, and the control still holds.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/** The app bin whose `lib` build the subprocess runs. */
const BIN_SCRIPT = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
/** The repo tsconfig (required by the smoke options; unused in `lib` mode). */
const TSCONFIG = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
/** The test-only path-mounted plugin. */
const PATH_PLUGIN = fileURLToPath(new URL('./fixtures/a-590-unverified-path-plugin.mjs', import.meta.url))
/** A distinctive substring of the path plugin's name/id/path, by any of which the banner could name it. */
const PLUGIN_TOKEN = 'a590-unverified-path-plugin'
/** A factory-bundle package — the product itself, which the banner must not name. */
const BUNDLE_PACKAGE = '@deepseek-ai/dsh-base'

/**
 * Whether a captured stderr has a line that names `token` and flags it as
 * having no verified provenance (the B-695 banner's wording and its kin).
 * @param stderr - the launch's stderr.
 * @param token - the identifier to look for on a provenance-warning line.
 * @returns true when such a line exists.
 */
function warnsUnverified(stderr: string, token: string): boolean {
  return stderr.split('\n').some(line =>
    line.includes(token) && /unverified|untrusted|not verified|no verified provenance/iu.test(line))
}

/** What one factory launch left. */
interface Launch {
  /** Whether the path-mounted plugin actually mounted (its marker is on disk). */
  readonly mounted: boolean
  /** The launch's stderr. */
  readonly stderr: string
}

/**
 * Launch the built `dsh` bin against a non-development base-bundle profile whose
 * own patch layer mounts the path plugin, and return whether it mounted and the
 * launch's stderr.
 * @returns the launch result.
 */
async function bootWithPathMountedPlugin(): Promise<Launch> {
  let mounted = false
  const result = await runLoaderSmoke({
    label: 'p1-02-a590-path-mounted-provenance',
    tempDirPrefix: 'p1-02-a590-',
    binScript: BIN_SCRIPT,
    configPath: '',
    binArgs: ['--profile', 'p1-02-a590'],
    tsconfigPath: TSCONFIG,
    mode: 'lib',
    prepare: (cwd) => {
      // runLoaderSmoke points DSH_HOME at <cwd>/.dsh.
      const profileDir = join(cwd, '.dsh', 'profiles', 'p1-02-a590')
      mkdirSync(profileDir, { recursive: true })
      const marker = join(cwd, 'path-plugin-marker')
      // A non-development base-bundle profile with no dependencies: it pins a
      // real Trust Kernel (not a development profile, no insecure opt-in), and
      // `verifyBootProvenance({}, …)` finds no dependency, so the only plugin
      // that runs with no verified provenance is the one the patch layer mounts.
      writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
        name: 'dsh-profile-p1-02-a590',
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'startup' } },
      }, undefined, 2)}\n`)
      // Mount the path plugin through the profile's own patch layer — a
      // config-tree entry, not a dependency, named by absolute path.
      writeFileSync(
        join(profileDir, 'cordis.patch.yml'),
        `- insert:\n    - id: a590-unverified-path-plugin\n      name: '${PATH_PLUGIN}'\n      config:\n        marker: '${marker}'\n`,
      )
    },
    inspect: (cwd) => {
      mounted = existsSync(join(cwd, 'path-plugin-marker'))
    },
  })
  return { mounted, stderr: result.stderr }
}

describe('P1-02 must[4] (Q30(b)), review 1-2: a path-mounted plugin runs unverified and must be named in the provenance banner (red first for B-707)', () => {
  it('names the path-mounted plugin in the no-verified-provenance banner, and never the factory bundle', async () => {
    const launch = await bootWithPathMountedPlugin()
    // Harness guard (green today and after): the path plugin actually mounted,
    // so "not named" below is the banner's gap, not a boot that never reached it.
    expect(launch.mounted, `stderr tail:\n${launch.stderr.slice(-1500)}`).toBe(true)
    // RED today: the banner is drawn from the profile's dependencies, so the
    // patch-mounted plugin — which runs with no verified provenance — is not
    // named (and with no unverified dependency the banner is not printed at
    // all). B-707 names it on every boot.
    expect(warnsUnverified(launch.stderr, PLUGIN_TOKEN), `stderr:\n${launch.stderr.slice(-1500)}`).toBe(true)
    // Control (green today and after): the factory bundle's own package is the
    // product, not an unverified plugin, and is never named by the banner.
    expect(warnsUnverified(launch.stderr, BUNDLE_PACKAGE), `stderr:\n${launch.stderr.slice(-1500)}`).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
