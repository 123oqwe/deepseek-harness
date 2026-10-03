/**
 * Epic P1-01's plugin admission and post-mount quarantine behind the
 * `plugin-manifest-enforcement` feature gate (BLOCKED-322): its declaration,
 * the launch environment's authority to lower it from `'enforce'` (user decision G1b), and
 * the `'shadow'` state, which composes and keeps every plugin exactly as
 * `'off'` does and appends what `'enforce'` would have done to the shadow
 * decision log. The same gate judges the rows the user patch layers mount
 * (B-519).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FiberState } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { boot, composeEntries, DEFAULT_PROFILE_PATCH_RELOAD, initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import {
  applyPostMountPluginEnforcement,
  composeProfile,
  FEATURE_GATE_DECLARATIONS,
  featureGateShadowLogPath,
  homePatchPath,
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

/** Stage one plugin package, with an optional `dsh` field, under a profile directory's own node_modules. */
function stagePluginPackage(profileDir: string, name: string, dsh?: Record<string, unknown>): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...dsh === undefined ? {} : { dsh } }))
}

/** A fresh `$DSH_HOME` holding profile `patched`, with no bundles, a package without a manifest and one with a benign manifest. */
function stagePatchedProfile(): string {
  useFreshHome()
  const dir = resolveProfileDir('patched')
  initProfile(dir, [], DEFAULT_PROFILE_PATCH_RELOAD)
  stagePluginPackage(dir, 'manifestless-plugin')
  stagePluginPackage(dir, 'declared-plugin', BENIGN_MANIFEST)
  return dir
}

/** Every row id the composed patch stack mounts, a group's rows included, in tree order. */
function composedIds(composed: Awaited<ReturnType<typeof composeProfile>>): string[] {
  const ids: string[] = []
  const visit = (entry: EntryOptions): void => {
    ids.push(entry.id)
    if (entry.group && Array.isArray(entry.config)) (entry.config as EntryOptions[]).forEach(visit)
  }
  composeEntries([composed.bundlePatches, composed.profile.patches, composed.homePatches, composed.overlays]).forEach(visit)
  return ids
}

/** The shadow records of the user patch rows' admission. */
function patchAdmissionRecords(): unknown[] {
  return readShadowRecords().filter(record => (record as { readonly stage?: unknown }).stage === 'pre-mount-patch-admission')
}

/** Run `action` with stderr captured, and return its result and what it wrote. */
async function captureStderr<T>(action: () => Promise<T>): Promise<{ readonly value: T; readonly stderr: string }> {
  const writes: string[] = []
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk))
    return true
  })
  try {
    const value = await action()
    return { value, stderr: writes.join('') }
  } finally {
    spy.mockRestore()
  }
}

const PROFILE_ROWS = [
  '- insert:',
  '    - id: manifestless-row',
  '      name: manifestless-plugin',
  '    - id: declared-row',
  '      name: declared-plugin',
  '    - id: builtin-row',
  '      name: cordis:noop',
  '',
].join('\n')

describe('plugin-manifest-enforcement gate: the rows user patch layers mount (B-519)', () => {
  it('shadow composes every row and records the rows enforce would refuse', async () => {
    const dir = stagePatchedProfile()
    writeFileSync(join(dir, 'cordis.patch.yml'), PROFILE_ROWS)

    const composed = await composeProfile('patched', [], 'shadow')

    expect(composedIds(composed)).toEqual(['manifestless-row', 'declared-row', 'builtin-row'])
    const records = patchAdmissionRecords()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      gateId: 'plugin-manifest-enforcement',
      differs: true,
      legacySummary: { admitted: ['manifestless-plugin', 'declared-plugin'], denied: [] },
      shadowSummary: {
        admitted: ['declared-plugin'],
        denied: [{
          patch: composed.profile.patchPath, row: 'manifestless-row', module: 'manifestless-plugin', reason: 'missing-manifest', wildcardPaths: [],
        }],
      },
    })
  })

  it('records nothing when the user layers mount only builtins', async () => {
    const dir = stagePatchedProfile()
    writeFileSync(join(dir, 'cordis.patch.yml'), '- insert:\n    - id: builtin-row\n      name: cordis:noop\n')

    await composeProfile('patched', [], 'shadow')

    expect(patchAdmissionRecords()).toEqual([])
  })

  it('enforce composes each user layer without its refused rows, names each on stderr, and leaves the files unchanged', async () => {
    const dir = stagePatchedProfile()
    const profileFile = join(dir, 'cordis.patch.yml')
    const homeFile = homePatchPath()
    writeFileSync(profileFile, PROFILE_ROWS)
    writeFileSync(homeFile, '- insert:\n    - id: home-row\n      name: manifestless-plugin\n')
    const overlay = join(mkdtempSync(join(tmpdir(), 'dsh-enforcement-gate-overlay-')), 'overlay.patch.yml')
    writeFileSync(overlay, [
      '- insert:',
      '    - id: overlay-group',
      '      name: cordis:group',
      '      group: true',
      '      config:',
      '        - id: overlay-row',
      '          name: manifestless-plugin',
      '',
    ].join('\n'))
    const files = [profileFile, homeFile, overlay]
    const before = files.map(file => readFileSync(file, 'utf8'))

    const { value: composed, stderr } = await captureStderr(() => composeProfile('patched', [overlay], 'enforce'))

    expect(composedIds(composed)).toEqual(['declared-row', 'builtin-row', 'overlay-group'])
    for (const [file, row] of [[profileFile, 'manifestless-row'], [homeFile, 'home-row'], [overlay, 'overlay-row']] as const) {
      expect(stderr).toContain(
        `dsh: plugin admission: excluding patch row ${JSON.stringify(row)} ("manifestless-plugin") of ${JSON.stringify(file)} `
        + 'from profile "patched" (missing-manifest)\n',
      )
    }
    expect(readShadowRecords()).toEqual([])
    expect(files.map(file => readFileSync(file, 'utf8'))).toEqual(before)
  })

  it('enforce refuses a row a patch swaps into a group, and leaves a plain row\'s list config alone', async () => {
    const dir = stagePatchedProfile()
    writeFileSync(join(dir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: user-group',
      '      name: cordis:group',
      '      group: true',
      '      config:',
      '        - id: declared-child',
      '          name: declared-plugin',
      '    - id: plain-row',
      '      name: declared-plugin',
      '      config: {}',
      '- id: user-group',
      '  config:',
      '    - id: swapped-child',
      '      name: manifestless-plugin',
      '    - id: kept-child',
      '      name: declared-plugin',
      '- id: plain-row',
      '  config:',
      '    - name: manifestless-plugin',
      '',
    ].join('\n'))

    const { value: composed, stderr } = await captureStderr(() => composeProfile('patched', [], 'enforce'))

    expect(composedIds(composed)).toEqual(['user-group', 'kept-child', 'plain-row'])
    const plain = composeEntries([composed.profile.patches]).find(entry => entry.id === 'plain-row')
    expect(plain?.config).toEqual([{ name: 'manifestless-plugin' }])
    expect(stderr).toContain('excluding patch row "swapped-child" ("manifestless-plugin")')
    expect(stderr).not.toContain('plain-row')
  })

  it('judges a module proxy by the installed package it forwards to, not by the proxy\'s own package.json', async () => {
    const dir = stagePatchedProfile()
    // A packaged install's proxy: its `dsh` field holds only `moduleFallback`.
    stagePluginPackage(dir, '@deepseek-ai/dsh-headless', { moduleFallback: { targets: {} } })
    writeFileSync(join(dir, 'cordis.patch.yml'), '- insert:\n    - id: proxied-row\n      name: "@deepseek-ai/dsh-headless"\n')

    await composeProfile('patched', [], 'shadow')

    expect(patchAdmissionRecords()[0]).toMatchObject({
      differs: false,
      shadowSummary: { admitted: ['@deepseek-ai/dsh-headless'], denied: [] },
    })
  })
})
