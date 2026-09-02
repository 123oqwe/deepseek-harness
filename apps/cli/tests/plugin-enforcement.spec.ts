/**
 * Epic P1-01.U's real enforcement wiring in `apps/cli/src/profile-boot.ts`:
 * `resolvePluginEnforcementMode` (the production opt-in switch),
 * `composeProfile`'s real pre-mount admission (must[3]/acceptance[0] — a
 * denied bundle layer's patches never reach `boot()`), and
 * `applyPostMountPluginEnforcement`'s real post-mount quarantine (a plugin
 * that registered an undeclared capability loses its live Cordis
 * registrations via `entry.fiber.dispose()`, not just a returned decision).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { FiberState } from '@deepseek-ai/cordis'
import { boot, DEFAULT_PROFILE_PATCH_RELOAD, initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { applyPostMountPluginEnforcement, composeProfile, resolvePluginEnforcementMode } from '../src/profile-boot.ts'

describe('resolvePluginEnforcementMode', () => {
  it('stays off when unset or empty', () => {
    expect(resolvePluginEnforcementMode(undefined)).toBe(false)
    expect(resolvePluginEnforcementMode('')).toBe(false)
  })

  it('opts in on exactly "enforce"', () => {
    expect(resolvePluginEnforcementMode('enforce')).toBe(true)
  })

  it('fails loud on any other value (misconfiguration, not a silent default)', () => {
    expect(() => resolvePluginEnforcementMode('ENFORCE')).toThrow(/must be "enforce" or unset/)
    expect(() => resolvePluginEnforcementMode('true')).toThrow(/got "true"/)
  })
})

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Stage one real on-disk bundle package under a profile directory's own node_modules, resolvable by `resolveBundleDir`'s second anchor. */
function stageBundlePackage(
  profileDir: string,
  name: string,
  dshManifestExtra: Record<string, unknown> | undefined,
  patch = '[]\n',
): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' }, ...dshManifestExtra },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), patch)
}

const home = () => mkdtempSync(join(tmpdir(), 'dsh-plugin-enforcement-home-'))

const originalDshHome = process.env.DSH_HOME

afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

describe('composeProfile: real pre-mount admission (must[3]/acceptance[0])', () => {
  it('composes every bundle layer unconditionally outside production, regardless of declaration', async () => {
    process.env.DSH_HOME = home()
    const dir = resolveProfileDir('demo')
    initProfile(dir, ['denied-plugin', 'admitted-plugin'], DEFAULT_PROFILE_PATCH_RELOAD)
    stageBundlePackage(dir, 'denied-plugin', undefined, '- id: denied-row\n  name: cordis:noop\n')
    stageBundlePackage(dir, 'admitted-plugin', {
      manifestVersion: 2,
      tools: [{
        name: 'example-tool', sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal',
      }],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }, '- id: admitted-row\n  name: cordis:noop\n')
    const composed = await composeProfile('demo', [], false)
    expect(composed.admittedLayerNames).toEqual(['denied-plugin', 'admitted-plugin'])
    expect(composed.deniedLayers).toEqual([])
    expect(composed.bundlePatches.some(patch => patch.id === 'denied-row')).toBe(true)
  })

  it('excludes a missing-manifest bundle layer\'s patches in production, admitting only the clean manifest-v2 layer', async () => {
    process.env.DSH_HOME = home()
    const dir = resolveProfileDir('demo')
    initProfile(dir, ['denied-plugin', 'admitted-plugin'], DEFAULT_PROFILE_PATCH_RELOAD)
    stageBundlePackage(dir, 'denied-plugin', undefined, '- id: denied-row\n  name: cordis:noop\n')
    stageBundlePackage(dir, 'admitted-plugin', {
      manifestVersion: 2,
      tools: [{
        name: 'example-tool', sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal',
      }],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    }, '- id: admitted-row\n  name: cordis:noop\n')
    const composed = await composeProfile('demo', [], true)
    expect(composed.admittedLayerNames).toEqual(['admitted-plugin'])
    // A package whose dsh field only carries dsh.bundle.patch (no
    // manifestVersion) classifies as legacy-untrusted, not missing — it does
    // declare *something*, just no capability manifest (must[3]).
    expect(composed.deniedLayers).toEqual([
      expect.objectContaining({ reason: 'legacy-untrusted' }),
    ])
    expect(composed.deniedLayers[0]?.layer.packageName).toBe('denied-plugin')
    // The denied plugin's row never reaches the composed patch stack boot() would mount.
    expect(composed.bundlePatches.some(patch => patch.id === 'denied-row')).toBe(false)
    expect(composed.bundlePatches.some(patch => patch.id === 'admitted-row')).toBe(true)
  })
})

/**
 * Uniquely-named real on-disk package under the repo's own node_modules,
 * resolvable both by Node's ordinary ancestor-walk `import()` (so the Loader
 * can mount it by bare specifier, matching `entry.options.name`) and by
 * `resolveEntryPackageDir`'s real (non-injected) resolution, which searches
 * that exact same specifier. Removed in `finally`.
 */
function stageRealResolvablePackage(name: string, dsh: Record<string, unknown> | undefined, applyBody: string): string {
  const dir = join(REPOSITORY_ROOT, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name, version: '1.0.0', type: 'module', main: './index.mjs', ...dsh === undefined ? {} : { dsh },
  }))
  writeFileSync(join(dir, 'index.mjs'), applyBody)
  return dir
}

const BENIGN_MANIFEST = {
  manifestVersion: 2,
  tools: [{
    name: 'example-tool', sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal',
  }],
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
}

describe('applyPostMountPluginEnforcement: real post-mount quarantine (must[3]/acceptance[0])', () => {
  it('is a no-op outside production', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-post-mount-'))
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    const ctx = await boot('post-mount-test', join(dir, 'cordis.yml'), undefined, () => {})
    try {
      await expect(applyPostMountPluginEnforcement(ctx, false, [])).resolves.toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('disposes a quarantined entry\'s fiber (an undeclared tool registration) and leaves a clean entry active', async () => {
    const good = `dsh-post-mount-good-${randomUUID()}`
    const bad = `dsh-post-mount-bad-${randomUUID()}`
    const goodDir = stageRealResolvablePackage(good, BENIGN_MANIFEST, [
      'export function apply(ctx) {',
      '  ctx.effect(function* () { yield () => {} }, `tools.register("example-tool")`)',
      '}',
      '',
    ].join('\n'))
    const badDir = stageRealResolvablePackage(bad, BENIGN_MANIFEST, [
      'export function apply(ctx) {',
      '  ctx.effect(function* () { yield () => {} }, `tools.register("example-tool")`)',
      '  ctx.effect(function* () { yield () => {} }, `tools.register("undeclared-tool")`)',
      '}',
      '',
    ].join('\n'))
    // The importing directory must sit inside the repo's own node_modules
    // ancestry — Node's bare-specifier resolution walks up from here, and an
    // OS tmpdir (outside the repo) would never reach node_modules/<pkg>.
    const treeParent = join(REPOSITORY_ROOT, 'node_modules', '.dsh-post-mount-test')
    mkdirSync(treeParent, { recursive: true })
    try {
      const dir = mkdtempSync(join(treeParent, 'tree-'))
      writeFileSync(
        join(dir, 'cordis.yml'),
        `- id: good\n  name: ${JSON.stringify(good)}\n`
        + `- id: bad\n  name: ${JSON.stringify(bad)}\n`,
      )
      const ctx = await boot('post-mount-test', join(dir, 'cordis.yml'), undefined, () => {})
      try {
        // The Loader namespaces entry ids by their containing include
        // ("include:good"); the module name is the stable identity here.
        const entries = () => [...ctx.loader.entries()]
        const goodEntry = entries().find(entry => entry.options.name === good)
        const badEntry = entries().find(entry => entry.options.name === bad)
        expect(goodEntry?.fiber).toBeDefined()
        expect(badEntry?.fiber).toBeDefined()

        await applyPostMountPluginEnforcement(ctx, true, [])

        const afterGood = entries().find(entry => entry.options.name === good)
        const afterBad = entries().find(entry => entry.options.name === bad)
        expect(afterGood?.fiber?.state).toBe(FiberState.ACTIVE)
        // The Loader either clears a disposed entry's fiber reference or
        // leaves it pointing at the now-DISPOSED fiber -- either is real disposal.
        const badFiberAfter = afterBad?.fiber
        expect(badFiberAfter === undefined || badFiberAfter.state === FiberState.DISPOSED).toBe(true)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      rmSync(goodDir, { recursive: true, force: true })
      rmSync(badDir, { recursive: true, force: true })
      rmSync(treeParent, { recursive: true, force: true })
    }
  })
})

// Registry validation item: "新增恶意 MCP server 与 Skill 脚本夹具，验证 ...
// tool-name collision ... 被拦截" (a malicious plugin registering a tool
// under a name a trusted plugin already owns must be intercepted). This is
// EXISTING real enforcement this epic did not add and does not need to
// duplicate: `packages/core/scope/src/store.ts`'s `NamedEntries.insert`
// (which `ToolRuntime.register` calls) already throws on a duplicate name,
// proved end to end by `packages/core/tools/tests/tools.spec.ts:1984`
// ("rejects duplicate names and unregisters on fiber dispose") and
// `packages/core/tools/tests/scoped.spec.ts:100` ("rejects a duplicate name
// within one layer"). A second, real-boot-level proof here would only
// re-test that same store, not this epic's own new enforcement.
