/**
 * Config-dump entry for `dsh --profile <name> --dump-config`: compose the
 * profile's patch layers through the include plugin's patch algorithm without
 * booting or evaluating `!!js`, with one source layer per bundle, the
 * profile's own patch file, and each `--patch` overlay.
 * @module @deepseek-ai/dsh/dump-config
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  loadOptionalPatches,
  loadOverlayPatches,
  renderConfigDump,
  type ConfigDumpLayer,
} from '@deepseek-ai/dsh-app-boot'
import type { FeatureGateResolution } from '@deepseek-ai/dsh-feature-gates'
import { homePatchPath, prepareProfile, PROFILE_ROOT_FILENAME, resolveProfileFeatureGates } from './profile-boot.ts'

const NAME = 'dsh'

/**
 * Render one `# == feature-gates` comment block naming every declared gate's
 * resolved source/value and its complete override chain (Epic P0-05
 * must[3]), lowest-precedence chain entry first -- the same per-row
 * provenance style `renderConfigDump`'s `# == <label>` groups already
 * establish for composed entries. Comment-prefixed throughout, so appending
 * this after a `renderConfigDump` dump keeps the combined output one
 * loadable YAML document. Returns `''` (nothing printed) when `gates` is
 * empty, which is this repository's real state today: no capability has
 * migrated behind a gate yet.
 * @param gates - the profile's resolved gates, in declaration order.
 * @returns the rendered comment block, or `''` when `gates` is empty.
 */
export function renderFeatureGateDump(gates: readonly FeatureGateResolution[]): string {
  if (gates.length === 0) return ''
  const lines: string[] = ['# == feature-gates']
  for (const gate of gates) {
    lines.push(`# ${gate.gateId}: ${gate.resolved.value} (source: ${gate.resolved.source})`)
    for (const entry of gate.chain) {
      lines.push(`#   ${entry.source}: ${entry.value}`)
    }
  }
  return lines.join('\n') + '\n'
}

/* v8 ignore start -- built-bin acceptance drives this boot-free dispatch */
/**
 * Print a profile composition with comments naming each source file and patch layer.
 * @param profile - the profile name.
 * @param defaultOnly - omit the profile's user layer and `--patch` overlays
 * (the recovery diagnostic for a broken `cordis.patch.yml`, which is then
 * never parsed).
 * @param patches - `--patch` overlay paths, in argv order.
 */
export function runDumpConfig(profile: string, defaultOnly: boolean, patches: readonly string[]): void {
  const loaded = prepareProfile(profile, !defaultOnly)
  const layers: ConfigDumpLayer[] = loaded.layers.map(layer => ({
    label: layer.packageName,
    patches: layer.patches,
  }))
  if (!defaultOnly) {
    if (existsSync(loaded.patchPath)) {
      layers.push({ label: loaded.patchPath, patches: loaded.patches })
    }
    const homePatchFile = homePatchPath()
    const homePatches = loadOptionalPatches(NAME, homePatchFile)
    if (homePatches !== undefined) {
      layers.push({ label: homePatchFile, patches: homePatches })
    }
    for (const file of patches) {
      const absolute = resolve(file)
      layers.push({ label: absolute, patches: loadOverlayPatches(NAME, absolute) })
    }
  }
  // The dump anchors on the same empty root file the boot includes.
  process.stdout.write(renderConfigDump(NAME, join(loaded.dir, PROFILE_ROOT_FILENAME), layers))
  // defaultOnly mirrors the entry layers above: the recovery diagnostic omits
  // externally supplied overrides, so only the declaration's own
  // default/profile layers show, never an env override.
  process.stdout.write(renderFeatureGateDump(resolveProfileFeatureGates(profile, undefined, defaultOnly ? {} : process.env)))
}
/* v8 ignore stop */
