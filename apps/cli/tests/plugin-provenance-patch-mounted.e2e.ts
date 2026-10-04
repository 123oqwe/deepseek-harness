/**
 * P1-02 must[4] / question 30 (b), incremental review 1-2 (A-590) and 2-? (A-590b):
 * on a non-development profile, a plugin mounted BY PATH — through the profile's
 * own `cordis.patch.yml`, the home patch, or `--patch` — runs with no verified
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
 * unverified.
 *
 * A-590b: a fix that reads only the patch's top-level `insert` list still misses
 * two ways a patch mounts a plugin by path that are not insert rows, so the
 * banner must enumerate the whole config tree, not the insert list:
 *   - a `cordis:group` inserted empty, then given a path child by a later
 *     config-replace row (the child is in the GROUP's config, not the insert list);
 *   - a `@deepseek-ai/cordis-plugin-include` row whose target YAML holds the path
 *     row (the child is in another file, reached through the include).
 *
 * Observed on the FACTORY LAUNCHER (the built `dsh` bin in `lib` mode, as a
 * subprocess), the A-578v2 observation: the src/lib module split makes an
 * in-process boot resolve a different provenance instance than the launcher. A
 * test-only `.mjs` plugin is mounted by one of the three path forms, records a
 * marker on mount (the harness guard that it really ran), and ends the launch;
 * the launch's stderr is read for the banner.
 *
 * Today no form's path-mounted plugin is named — RED — while the control (no
 * bundle package named) holds; B-707 names each on every boot, and the control
 * still holds.
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
/**
 * The path plugin's file basename. The banner names a path-mounted plugin by its
 * config-row id and its `file:` URL, NOT by the plugin's self-reported export
 * name; the row id differs per mount form (a group/include child has its own id),
 * so the file basename — present in the `file:` URL of every form — is the one
 * token that identifies this plugin across all three.
 */
const PLUGIN_TOKEN = 'a-590-unverified-path-plugin'
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
 * own patch layer mounts the path plugin one of three ways, and return whether
 * it mounted and the launch's stderr.
 *
 * The profile is a non-development base bundle with no dependencies: it pins a
 * real Trust Kernel (not a development profile, no insecure opt-in), and
 * `verifyBootProvenance({}, …)` finds no dependency, so the only plugin that runs
 * with no verified provenance is the one the patch layer mounts.
 * @param profileName - the per-form profile directory name.
 * @param writePatch - writes the form's `cordis.patch.yml` (and any file an include targets) into the profile dir.
 * @returns the launch result.
 */
async function bootWithPathForm(profileName: string, writePatch: (profileDir: string, marker: string) => void): Promise<Launch> {
  let mounted = false
  const result = await runLoaderSmoke({
    label: `p1-02-${profileName}`,
    tempDirPrefix: `p1-02-${profileName}-`,
    binScript: BIN_SCRIPT,
    configPath: '',
    binArgs: ['--profile', profileName],
    tsconfigPath: TSCONFIG,
    mode: 'lib',
    // The path plugin is a test fixture with no Manifest v2, which plugin-manifest enforcement would refuse to mount.
    env: { DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT: 'shadow' },
    prepare: (cwd) => {
      // runLoaderSmoke points DSH_HOME at <cwd>/.dsh.
      const profileDir = join(cwd, '.dsh', 'profiles', profileName)
      mkdirSync(profileDir, { recursive: true })
      const marker = join(cwd, 'path-plugin-marker')
      writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
        name: `dsh-profile-${profileName}`,
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'startup' } },
      }, undefined, 2)}\n`)
      writePatch(profileDir, marker)
    },
    inspect: (cwd) => {
      mounted = existsSync(join(cwd, 'path-plugin-marker'))
    },
  })
  return { mounted, stderr: result.stderr }
}

/** A patch that mounts the path plugin as a top-level `insert` row (A-590). */
function directInsertPatch(profileDir: string, marker: string): void {
  writeFileSync(
    join(profileDir, 'cordis.patch.yml'),
    `- insert:\n    - id: a590-unverified-path-plugin\n      name: '${PATH_PLUGIN}'\n      config:\n        marker: '${marker}'\n`,
  )
}

/**
 * A patch that inserts an empty `cordis:group`, then gives it the path plugin as
 * a child through a later config-replace row — so the path plugin is in the
 * group's config, never in the patch's `insert` list (A-590b).
 */
function groupChildPatch(profileDir: string, marker: string): void {
  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: a590b-group',
    '      name: cordis:group',
    '      group: true',
    '      config: []',
    '- id: a590b-group',
    '  config:',
    '    - id: a590b-group-child',
    `      name: '${PATH_PLUGIN}'`,
    '      config:',
    `        marker: '${marker}'`,
    '',
  ].join('\n'))
}

/**
 * A patch that inserts a `cordis-plugin-include` whose target YAML holds the path
 * plugin row — so the path plugin is in another file, reached through the
 * include, never in the patch's `insert` list (A-590b).
 */
function includedFilePatch(profileDir: string, marker: string): void {
  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: a590b-include',
    "      name: '@deepseek-ai/cordis-plugin-include'",
    '      config:',
    "        path: './a590b-included.yml'",
    '',
  ].join('\n'))
  writeFileSync(join(profileDir, 'a590b-included.yml'), [
    '- id: a590b-include-child',
    `  name: '${PATH_PLUGIN}'`,
    '  config:',
    `    marker: '${marker}'`,
    '',
  ].join('\n'))
}

/**
 * Assert the launch mounted the path plugin and names it on a no-verified-provenance
 * line, and never names the factory bundle.
 * @param launch - the launch result.
 */
function expectNamedButNotBundle(launch: Launch): void {
  // Harness guard (green today and after): the path plugin actually mounted,
  // so "not named" below is the banner's gap, not a boot that never reached it.
  expect(launch.mounted, `stderr tail:\n${launch.stderr.slice(-1500)}`).toBe(true)
  // RED today: the banner is drawn from the profile's dependencies, so a
  // path-mounted plugin — which runs with no verified provenance — is not named
  // (and with no unverified dependency the banner is not printed at all). B-707
  // names it on every boot.
  expect(warnsUnverified(launch.stderr, PLUGIN_TOKEN), `stderr:\n${launch.stderr.slice(-1500)}`).toBe(true)
  // Control (green today and after): the factory bundle's own package is the
  // product, not an unverified plugin, and is never named by the banner.
  expect(warnsUnverified(launch.stderr, BUNDLE_PACKAGE), `stderr:\n${launch.stderr.slice(-1500)}`).toBe(false)
}

describe('P1-02 must[4] (Q30(b)), review 1-2/2 (A-590, A-590b): a path-mounted plugin runs unverified and must be named in the provenance banner, however the patch mounts it (red first for B-707)', () => {
  it('names a plugin mounted by a top-level insert row, and never the factory bundle', async () => {
    expectNamedButNotBundle(await bootWithPathForm('p1-02-a590', directInsertPatch))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('names a plugin mounted as a cordis:group child added by a config-replace row (not in the insert list)', async () => {
    expectNamedButNotBundle(await bootWithPathForm('p1-02-a590b-group', groupChildPatch))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('names a plugin mounted through a cordis-plugin-include target file (not in the insert list)', async () => {
    expectNamedButNotBundle(await bootWithPathForm('p1-02-a590b-include', includedFilePatch))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
