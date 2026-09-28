/**
 * Epic P1-01's plugin admission and post-mount quarantine behind the
 * `plugin-manifest-enforcement` feature gate (BLOCKED-322): its declaration,
 * the launch environment's authority to lower it from `'enforce'` (user decision G1b), and
 * the `'shadow'` state, which composes and keeps every plugin exactly as
 * `'off'` does and appends what `'enforce'` would have done to the shadow
 * decision log.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { FiberState } from '@deepseek-ai/cordis'
import { boot, DEFAULT_PROFILE_PATCH_RELOAD, initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import {
  applyPostMountPluginEnforcement,
  composeProfile,
  FEATURE_GATE_DECLARATIONS,
  featureGateShadowLogPath,
  PLUGIN_MANIFEST_ENFORCEMENT_GATE,
  resolveProfileFeatureGates,
} from '../src/profile-boot.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const BENIGN_MANIFEST = {
  manifestVersion: 2,
  tools: [{
    name: 'example-tool', sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal',
  }],
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
}

const originalDshHome = process.env.DSH_HOME

afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

/** Point `$DSH_HOME` at a fresh directory for one case. */
function useFreshHome(): void {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-enforcement-gate-home-'))
}

/** Every line of the shadow decision log, parsed; empty when the log was never written. */
function readShadowRecords(): unknown[] {
  const path = featureGateShadowLogPath()
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as unknown)
}

/** Stage one bundle package, with `dsh` fields beside `bundle.patch`, under a profile directory's own node_modules. */
function stageBundlePackage(profileDir: string, name: string, dshExtra: Record<string, unknown>, patch: string): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' }, ...dshExtra },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), patch)
}

describe('plugin-manifest-enforcement gate: declaration and launch-environment override', () => {
  it('is declared with shadow as every profile\'s default', () => {
    expect(FEATURE_GATE_DECLARATIONS).toContain(PLUGIN_MANIFEST_ENFORCEMENT_GATE)
    expect(PLUGIN_MANIFEST_ENFORCEMENT_GATE.defaultByProfile).toEqual({ default: 'shadow' })
    for (const profile of ['headless', 'sdk', 'acp', 'web', 'sdk-minimal', 'a-custom-profile']) {
      expect(resolveProfileFeatureGates(profile, [PLUGIN_MANIFEST_ENFORCEMENT_GATE], {})[0]?.resolved)
        .toEqual({ source: 'default', value: 'shadow' })
    }
  })

  it('lets the launch environment lower an enforce floor to shadow or off (user decision G1b)', () => {
    const enforceFloor = { ...PLUGIN_MANIFEST_ENFORCEMENT_GATE, defaultByProfile: { default: 'enforce' as const } }
    for (const value of ['shadow', 'off'] as const) {
      const resolution = resolveProfileFeatureGates('headless', [enforceFloor], {
        DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT: value,
      })[0]
      expect(resolution?.chain).toEqual([{ source: 'default', value: 'enforce' }, { source: 'env', value }])
    }
  })
})

describe('plugin-manifest-enforcement gate: shadow', () => {
  it('composes every bundle layer exactly as off does, and records the layer enforce would deny', async () => {
    useFreshHome()
    const dir = resolveProfileDir('demo')
    initProfile(dir, ['denied-plugin', 'admitted-plugin'], DEFAULT_PROFILE_PATCH_RELOAD)
    stageBundlePackage(dir, 'denied-plugin', {}, '- id: denied-row\n  name: cordis:noop\n')
    stageBundlePackage(dir, 'admitted-plugin', BENIGN_MANIFEST, '- id: admitted-row\n  name: cordis:noop\n')

    const off = await composeProfile('demo', [], 'off')
    expect(readShadowRecords()).toEqual([])
    const shadow = await composeProfile('demo', [], 'shadow')

    expect(shadow.admittedLayerNames).toEqual(off.admittedLayerNames)
    expect(shadow.deniedLayers).toEqual([])
    expect(shadow.bundlePatches).toEqual(off.bundlePatches)
    expect(shadow.bundlePatches.some(patch => patch.id === 'denied-row')).toBe(true)
    const records = readShadowRecords()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      stage: 'pre-mount-admission',
      gateId: 'plugin-manifest-enforcement',
      differs: true,
      legacySummary: { admitted: ['denied-plugin', 'admitted-plugin'], denied: [] },
      shadowSummary: {
        admitted: ['admitted-plugin'],
        denied: [{ layer: 'denied-plugin', reason: 'legacy-untrusted', wildcardPaths: [] }],
      },
    })
  })

  it('disposes nothing after mount, and records the entry enforce would quarantine', async () => {
    useFreshHome()
    const bad = `dsh-enforcement-gate-bad-${randomUUID()}`
    const badDir = join(REPOSITORY_ROOT, 'node_modules', bad)
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'package.json'), JSON.stringify({
      name: bad, version: '1.0.0', type: 'module', main: './index.mjs', dsh: BENIGN_MANIFEST,
    }))
    writeFileSync(join(badDir, 'index.mjs'), [
      'export function apply(ctx) {',
      '  ctx.effect(function* () { yield () => {} }, `tools.register("example-tool")`)',
      '  ctx.effect(function* () { yield () => {} }, `tools.register("undeclared-tool")`)',
      '}',
      '',
    ].join('\n'))
    // Inside the repository's own node_modules ancestry, so both the Loader's
    // bare-specifier import and the inventory's package resolution find it.
    const treeParent = join(REPOSITORY_ROOT, 'node_modules', '.dsh-enforcement-gate-test')
    mkdirSync(treeParent, { recursive: true })
    try {
      const dir = mkdtempSync(join(treeParent, 'tree-'))
      writeFileSync(join(dir, 'cordis.yml'), `- id: bad\n  name: ${JSON.stringify(bad)}\n`)
      const ctx = await boot('enforcement-gate-test', join(dir, 'cordis.yml'), undefined, () => {})
      try {
        await applyPostMountPluginEnforcement(ctx, 'shadow', [])

        const badEntry = [...ctx.loader.entries()].find(entry => entry.options.name === bad)
        expect(badEntry?.fiber?.state).toBe(FiberState.ACTIVE)
        const records = readShadowRecords()
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          stage: 'post-mount-comparison',
          gateId: 'plugin-manifest-enforcement',
          differs: true,
          legacySummary: { quarantined: [] },
          shadowSummary: {
            quarantined: [{
              package: bad,
              entries: [badEntry?.id],
              mismatches: [{ kind: 'undeclared-registration', category: 'tool', name: 'undeclared-tool' }],
              wildcardPaths: [],
            }],
          },
        })
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      rmSync(badDir, { recursive: true, force: true })
      rmSync(treeParent, { recursive: true, force: true })
    }
  })
})
