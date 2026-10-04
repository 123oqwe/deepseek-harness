/**
 * A-579b / P1-01 step 3 (clause ⑤, red first for B-519): on a LIVE-reload
 * profile (`dsh.profile.patchReload: 'live'`, the reload lifecycle the shipped
 * `web` profile uses — the only template with `'live'`, `PROFILE_TEMPLATES` in
 * `@deepseek-ai/dsh-app-boot`), a user edit to the profile's own
 * `cordis.patch.yml` that inserts a package declaring NO `dsh` manifest must be
 * refused on reload, exactly as `composeProfile` refuses it before boot. The
 * live user layer is recomposed through `composeLive` → `refuseUserPatchRows`
 * (apps/cli/src/profile-boot.ts), the same per-row pre-mount admission the
 * boot-time pre-filter runs, so a live edit can mount no package a cold boot
 * would refuse.
 *
 * Why a base-backed `'live'` profile, not the `web` bundle: the reload watcher
 * is the launcher's OWN watch-only HMR instance — `dsh-base` ships its `hmr`
 * row disabled, so `runProfile` mounts a `{ root: [] }` HMR and calls
 * `watchUserPatches(…, { compose: composeLive })` for the profile and home patch
 * files (profile-boot.ts). That path is identical for `web` and for any other
 * `'live'` profile; it is wired by `patchReload: 'live'`, not by the web bundle.
 * The `web` bundle only adds the HTTP server bind and the built-frontend dist
 * resolution (packages/bundle/web-app/cordis.patch.yml: `webserver`,
 * `web-runtime`, whose consumers like `connection` inject `webRuntime`), neither
 * of which touches the gate under test, so this case boots the base bundle and
 * keeps the web server out of an in-process test.
 *
 * RED today: a boot with no enforcement env resolves
 * `PLUGIN_MANIFEST_ENFORCEMENT_GATE` to its `'shadow'` default, whose admission
 * runs `partitionUserPatchRowsByAdmission(rows, dir, production=false)` and
 * admits EVERY user-patch row unconditionally (profile-boot.ts;
 * `evaluatePreMountAdmission` returns `{ admitted: true }` on the non-production
 * path, packages/plugin/plugin-manifest/src/index.ts). So the manifest-less
 * package mounts on reload. B-519 refuses a manifest-less user-patch package
 * under the factory default, so the live edit mounts nothing. §21.4: the fix
 * diff is not read.
 *
 * The reload runs through the REAL watcher: `watchUserPatches` awaits the HMR
 * watcher `ready` before `runProfile` resolves (hmr.registerConfig,
 * vendor/hmr/src/index.ts), so a file write after boot is seen. A `disabled`
 * toggle on an existing base row, carried in the SAME edit, is a row that mounts
 * no package, so it is never a refusal candidate and applies on both the pre-
 * and post-fix tree — the positive marker that the reload generation ran, so the
 * manifest-less read below is never taken before the reload settles.
 *
 * @module apps/cli/tests/plugin-live-reload-admission
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../src/profile-boot.ts'

/**
 * The enforcement gate's env override
 * (`featureGateEnvVarName('plugin-manifest-enforcement')`); unset here, so the
 * gate resolves to its factory `'shadow'` default.
 */
const ENFORCEMENT_ENV = 'DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT'

const LAUNCH_TIMEOUT_MS = 60_000

const roots: string[] = []
const originalDshHome = process.env.DSH_HOME
const originalEnforcement = process.env[ENFORCEMENT_ENV]
const originalInsecure = process.env.DSH_TRUST_KERNEL_INSECURE
afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  if (originalEnforcement === undefined) Reflect.deleteProperty(process.env, ENFORCEMENT_ENV)
  else process.env[ENFORCEMENT_ENV] = originalEnforcement
  if (originalInsecure === undefined) delete process.env.DSH_TRUST_KERNEL_INSECURE
  else process.env.DSH_TRUST_KERNEL_INSECURE = originalInsecure
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Poll `test` until it holds or the deadline passes, giving the real file watcher time to deliver the reload. */
async function eventually(test: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(settle => setTimeout(settle, 25))
  }
}

/**
 * Stage a loadable package with NO `dsh` manifest, referenced by a cordis row's
 * `name` — a real plugin (`name`/`apply`) that mounts but is manifest-less, so a
 * production admission denies it for no reason of its own (`kind: 'missing'`).
 * @param profileDir - the profile directory whose `node_modules` holds it.
 * @param name - the package name.
 */
function stageLoadablePackage(profileDir: string, name: string): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: './index.mjs' }))
  writeFileSync(join(pkgDir, 'index.mjs'), `export const name = ${JSON.stringify(name)}\nexport function apply() {}\n`)
}

/** The live entry under an id: its mounted fiber (if any) and module name. */
function entry(ctx: Context, id: string): { readonly fiber: unknown; readonly name: unknown } | undefined {
  const found = [...ctx.loader.entries()].find(item => item.options.id === id)
  return found === undefined ? undefined : { fiber: found.fiber, name: found.options.name }
}

describe('P1-01 step 3 (A-579b, B-708 sibling B-519 red first): a live-reload profile refuses a manifest-less package edited into its patch file', () => {
  it('⑤ a user edit inserting a manifest-less package on a patchReload:"live" profile does not mount it (today it does — RED)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'a-579b-live-reload-'))
    roots.push(root)
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    mkdirSync(cwd, { recursive: true })
    const name = 'a-579b-live'
    const profileDir = join(home, 'profiles', name)
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
      name: `dsh-profile-${name}`,
      private: true,
      dependencies: {},
      // patchReload:'live' is the web profile's reload lifecycle; development
      // keeps the base Trust Kernel's development posture, as the plugin-grants
      // real-boot cases do.
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'live', development: true } },
    }, undefined, 2)}\n`)
    writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
    stageLoadablePackage(profileDir, 'manifestless-pkg')

    process.env.DSH_HOME = home
    delete process.env.DSH_TRUST_KERNEL_INSECURE
    // Factory default: no enforcement env, so the gate resolves to 'shadow'.
    Reflect.deleteProperty(process.env, ENFORCEMENT_ENV)

    const { ctx } = await runProfile({
      environment: loadLayeredEnv('dsh', cwd),
      profile: name,
      fromDefaultProfile: undefined,
      patchFiles: [],
      args: [],
    })
    try {
      // The base logger-stderr row mounts; its disappearance is the marker.
      expect(entry(ctx, 'logger-stderr')?.fiber, 'logger-stderr must mount before the reload disables it').toBeDefined()

      const patchPath = join(profileDir, 'cordis.patch.yml')
      // One live edit: disable an existing base row (a no-package row, never a
      // refusal candidate — the both-sides marker) AND insert the manifest-less
      // package (the subject).
      writeFileSync(patchPath, [
        '- id: logger-stderr',
        '  disabled: true',
        '- insert:',
        '    - id: a579b-manifestless',
        '      name: manifestless-pkg',
        '',
      ].join('\n'))

      await eventually(() => entry(ctx, 'logger-stderr')?.fiber === undefined, 'the live reload did not apply (logger-stderr stayed mounted)')
      await ctx.loader.await()

      const manifestless = entry(ctx, 'a579b-manifestless')
      const liveManifestless = manifestless !== undefined && manifestless.name === 'manifestless-pkg' && manifestless.fiber !== undefined
      const detail = JSON.stringify({ liveManifestless, names: [...ctx.loader.entries()].map(item => item.options.id) })
      // RED today: the factory-default shadow admission admits the manifest-less
      // row on reload, so it mounts. B-519 refuses it under the factory default.
      expect(liveManifestless, detail).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  }, LAUNCH_TIMEOUT_MS)
})
