#!/usr/bin/env node
/**
 * Driver for A-558b: P1-01 admission + post-mount quarantine on a BASE-FREE
 * profile of self-contained test layers, through the shipped `runProfile`
 * (must[3], acceptance[0]; BLOCKED-322). Because no layer depends on base
 * services, the tree activates without base — so this isolates the 甲/乙
 * comparison fix without base's Q27 dependency (A-558a covers the shipped
 * composition under enforce).
 *
 * Each entry layer registers nothing real: its `apply` emits a LABELED effect
 * (`ctx.effect(gen, 'tools.register("<name>")')`) that `buildObservedPluginCapabilities`
 * reads from the Fiber's effect labels, so it needs no base `tools` service. The
 * quarantine decision is manifest-declared vs label-observed.
 *
 * Both enforcement env vars are set to `enforce` so this one driver enforces
 * unchanged across B-519's two commits. No headless layer means no task-arg
 * check and no model is needed; the driver observes admission (stderr excludes)
 * and quarantine (`ctx.loader.entries()` fiber state), catching a boot failure.
 *
 * This increment stages the two control layers (match-stays, missing-manifest);
 * the three quarantine layers follow. It prints one `P1-01-QUARANTINE <json>`
 * line: each live Loader entry and whether its fiber is ACTIVE.
 * @module tests/first100/fixtures/loader/p1-01-quarantine/driver
 */

import { type Context, FiberState } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PROFILE_PATCH_RELOAD, initProfile, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import { DECLARES_UNREGISTERED_LAYER, MATCH_STAYS_LAYER, MATCH_TOOL, MISMATCH_NAME, MISSING_MANIFEST_LAYER, SUBPATH_UNDECLARED_LAYER } from './shared.ts'

/** A manifest-v2 `dsh` field declaring one tool by name. */
function manifestDeclaring(toolName: string): Record<string, unknown> {
  return {
    manifestVersion: 2,
    tools: [{ name: toolName, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal' }],
    executionMode: 'in-process',
    compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
  }
}

/** Stage a bundle package under the profile's own node_modules. `dshExtra` is undefined for a legacy (no-manifest) layer. */
function stageBundlePackage(profileDir: string, name: string, dshExtra: Record<string, unknown> | undefined, patch: string, entryModule?: string): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' }, ...dshExtra },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), patch)
  // An entry module whose `apply` emits a labeled effect — the observed capability,
  // read from Fiber effect labels, needing no base service.
  if (entryModule !== undefined) writeFileSync(join(pkgDir, 'index.mjs'), entryModule)
}

/** An `index.mjs`/`startup.mjs` whose `apply` labels a `tools.register(<name>)` effect. */
function labeledToolEntry(toolName: string): string {
  return [
    'export function apply(ctx) {',
    `  ctx.effect(function* () { yield () => {} }, 'tools.register(${JSON.stringify(toolName)})')`,
    '}',
    '',
  ].join('\n')
}

/** Stage a bundle package whose entry is at a `/startup` SUBPATH; its manifest resolves to the package root. */
function stageSubpathLayer(profileDir: string, name: string, declaredTool: string, observedTool: string): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    exports: { './startup': './startup.mjs' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, ...manifestDeclaring(declaredTool) },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${name}-startup\n      name: ${name}/startup\n`)
  writeFileSync(join(pkgDir, 'startup.mjs'), labeledToolEntry(observedTool))
}

const home = mkdtempSync(join(tmpdir(), 'p1-01-quarantine-home-'))
process.env.DSH_HOME = home
process.env.DSH_PLUGIN_MANIFEST_ENFORCEMENT = 'enforce'
process.env.DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT = 'enforce'

const profileName = 'p1-01-quarantine'
const profileDir = resolveProfileDir(profileName, home)
initProfile(profileDir, [MATCH_STAYS_LAYER, MISSING_MANIFEST_LAYER, DECLARES_UNREGISTERED_LAYER, SUBPATH_UNDECLARED_LAYER], DEFAULT_PROFILE_PATCH_RELOAD)

// match-stays: manifest-v2 declares MATCH_TOOL, and its entry labels a
// tools.register(MATCH_TOOL) effect — declared == observed → admitted, not
// quarantined → STAYS.
stageBundlePackage(
  profileDir, MATCH_STAYS_LAYER, manifestDeclaring(MATCH_TOOL),
  `- insert:\n    - id: ${MATCH_STAYS_LAYER}-entry\n      name: ${MATCH_STAYS_LAYER}\n`,
  labeledToolEntry(MATCH_TOOL),
)
// missing-manifest: dsh.bundle.patch, no manifestVersion → legacy-untrusted → denied.
stageBundlePackage(
  profileDir, MISSING_MANIFEST_LAYER, undefined,
  `- id: ${MISSING_MANIFEST_LAYER}-row\n  name: cordis:noop\n`,
)
// declares-unregistered: manifest-v2 declares MATCH_TOOL, but its entry labels a
// DIFFERENT tool (MISMATCH_NAME) — declared-not-observed and observed-not-declared,
// so it must be QUARANTINED. RED today: staged in the profile's node_modules, the
// package is not resolvable from plugin-inventory's own location, so the comparison
// skips it and it is never quarantined (stays present + ACTIVE). Green after 甲.
stageBundlePackage(
  profileDir, DECLARES_UNREGISTERED_LAYER, manifestDeclaring(MATCH_TOOL),
  `- insert:\n    - id: ${DECLARES_UNREGISTERED_LAYER}-entry\n      name: ${DECLARES_UNREGISTERED_LAYER}\n`,
  labeledToolEntry(MISMATCH_NAME),
)
// subpath-undeclared: a /startup SUBPATH entry whose manifest (resolved to the
// package root) declares MATCH_TOOL but whose entry labels MISMATCH_NAME —
// observed-not-declared. Must be QUARANTINED. RED today (skipped / subpath not
// resolved to its package); green after 甲.
stageSubpathLayer(profileDir, SUBPATH_UNDECLARED_LAYER, MATCH_TOOL, MISMATCH_NAME)

let ctx: Context | undefined
let bootError: string | undefined
try {
  ctx = (await runProfile({
    environment: loadLayeredEnv('dsh', process.cwd()),
    profile: profileName,
    fromDefaultProfile: undefined,
    patchFiles: [],
    args: [],
  })).ctx
} catch (error) {
  bootError = error instanceof Error ? error.message : String(error)
}
try {
  const report = {
    bootSucceeded: ctx !== undefined,
    bootError: bootError ?? null,
    loaderEntries: ctx === undefined ? [] : [...ctx.loader.entries()].map(entry => ({
      name: entry.options.name,
      active: entry.fiber?.state === FiberState.ACTIVE,
    })),
  }
  process.stdout.write(`P1-01-QUARANTINE ${JSON.stringify(report)}\n`)
} finally {
  if (ctx !== undefined) await ctx.fiber.dispose()
}
