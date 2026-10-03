/**
 * P1-01 steps 2–3 (B-519): on the SHIPPED factory default (no enforcement env,
 * which resolves the plugin-manifest-enforcement gate to its `'shadow'`
 * default, apps/cli/src/profile-boot.ts), a first-party wildcard grant is
 * recorded at startup and a third-party wildcard layer is refused.
 *
 * This file carries the two clauses whose observation surfaces are settled:
 *  - ② a THIRD-PARTY layer (a package the install does not carry, staged in the
 *    profile directory) that declares a wildcard-destination tool is refused by
 *    the real pre-mount admission `composeProfile` runs, even under the factory
 *    default;
 *  - ① a real factory boot writes a startup grant record naming the first-party
 *    wildcard tools dsh-base is granted, at
 *    `$DSH_HOME/feature-gates/admission-decisions.jsonl`.
 *
 * Red first for B-519 steps 2–3 (§21.4: the fix diff is not read). Clauses ④
 * (an id-rename to a manifest-less package is refused) and ⑥ (a manifest-less
 * layer still mounts under shadow and is shadow-logged) are the rest of A-579;
 * their real-boot mount and shadow-log observation is pending a delegate ruling
 * and lands in a following increment on this branch.
 *
 * Today the factory default admits every layer unconditionally under shadow
 * (`evaluatePreMountAdmission` returns `{admitted:true}` on the non-production
 * path) and writes no grant record, so ② and ① are red; B-519 refuses the
 * third-party wildcard and records the first-party grants.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_PROFILE_PATCH_RELOAD, initProfile, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { composeProfile, runProfile } from '../src/profile-boot.ts'

/** The enforcement gate's env override name (`featureGateEnvVarName('plugin-manifest-enforcement')`). */
const ENFORCEMENT_ENV = 'DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT'

/**
 * The plugin-manifest-enforcement gate's own default state
 * (`PLUGIN_MANIFEST_ENFORCEMENT_GATE.defaultByProfile.default`,
 * apps/cli/src/profile-boot.ts) — what "no enforcement env set" resolves to.
 */
const FACTORY_DEFAULT_ENFORCEMENT = 'shadow' as const

/** The eight first-party wildcard-bearing tools dsh-base declares (base/package.json `dsh.tools`). */
const BASE_WILDCARD_TOOLS = ['read', 'read_image', 'glob', 'grep', 'write', 'edit', 'web_fetch', 'run_code'] as const

const LAUNCH_TIMEOUT_MS = 60_000

/** A Manifest v2 whose single tool reaches an unrestricted network destination. */
const WILDCARD_MANIFEST = {
  manifestVersion: 2,
  tools: [{
    name: 'reach-anything', sideEffectClass: 'network', authAudience: ['model'],
    allowedDestinations: [{ kind: 'network', hostPattern: '*' }], dataClassification: 'internal',
  }],
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
}

/**
 * Stage one on-disk bundle package under a profile directory's own node_modules
 * — the second anchor `resolveBundleDir` searches, and a name the install does
 * not carry, so it is a third-party layer.
 * @param profileDir - the profile directory.
 * @param name - the package (and layer) name.
 * @param dshManifestExtra - the `dsh` fields beyond `bundle.patch`.
 * @param patch - the bundle's `cordis.patch.yml` body.
 */
function stageBundlePackage(
  profileDir: string,
  name: string,
  dshManifestExtra: Record<string, unknown>,
  patch: string,
): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' }, ...dshManifestExtra },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), patch)
}

const homes: string[] = []
const roots: string[] = []
const originalDshHome = process.env.DSH_HOME
const originalEnforcement = process.env[ENFORCEMENT_ENV]
afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  if (originalEnforcement === undefined) Reflect.deleteProperty(process.env, ENFORCEMENT_ENV)
  else process.env[ENFORCEMENT_ENV] = originalEnforcement
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A fresh harness home, set as `DSH_HOME`. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'p1-01-grants-'))
  homes.push(home)
  process.env.DSH_HOME = home
  return home
}

describe('P1-01 step 2: on the factory default (no env → shadow), a third-party wildcard layer is refused before startup (red first for B-519)', () => {
  it('② refuses a profile-directory layer whose Manifest v2 declares a wildcard destination, leaving its patches out', async () => {
    freshHome()
    const dir = resolveProfileDir('demo')
    initProfile(dir, ['third-party-wildcard'], DEFAULT_PROFILE_PATCH_RELOAD)
    stageBundlePackage(dir, 'third-party-wildcard', WILDCARD_MANIFEST, '- id: wildcard-row\n  name: cordis:noop\n')
    // The factory default: the gate resolves to 'shadow' with no env set. B-519
    // refuses a third-party wildcard here regardless; today shadow admits every
    // layer unconditionally (like 'off'), recording only to the shadow log.
    const composed = await composeProfile('demo', [], FACTORY_DEFAULT_ENFORCEMENT)
    const denied = composed.deniedLayers.map(layer => layer.layer.packageName)
    const detail = JSON.stringify({ admitted: composed.admittedLayerNames, denied })
    // RED today: the wildcard layer is admitted and its row reaches the mount stack.
    expect(composed.admittedLayerNames, detail).not.toContain('third-party-wildcard')
    expect(composed.bundlePatches.some(patch => patch.id === 'wildcard-row'), detail).toBe(false)
  })
})

/** The grants a startup admission record carries for one layer. */
interface GrantRecord {
  readonly layer: string
  readonly decision: string
  readonly grants?: readonly { readonly tool: string; readonly source: string; readonly purpose?: string }[]
}

/**
 * Boot a base-bundle factory profile (no enforcement env → shadow) over an
 * isolated `$DSH_HOME`, and return the lines of
 * `$DSH_HOME/feature-gates/admission-decisions.jsonl`, each parsed, or an empty
 * list when the file does not exist.
 * @returns the parsed startup admission records.
 */
async function bootAndReadAdmissionDecisions(): Promise<GrantRecord[]> {
  const root = mkdtempSync(join(tmpdir(), 'p1-01-admit-'))
  roots.push(root)
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(cwd, { recursive: true })
  const profileDir = join(home, 'profiles', 'p1-01-admit')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-p1-01-admit',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'startup', development: true } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  process.env.DSH_HOME = home
  delete process.env.DSH_TRUST_KERNEL_INSECURE
  const decisionsPath = join(home, 'feature-gates', 'admission-decisions.jsonl')
  return runProfile({
    environment: loadLayeredEnv('dsh', cwd),
    profile: 'p1-01-admit',
    fromDefaultProfile: undefined,
    patchFiles: [],
    args: [],
  }).then(
    async ({ ctx }) => {
      await ctx.fiber.dispose()
      let raw: string
      try {
        raw = readFileSync(decisionsPath, 'utf8')
      } catch {
        // No startup admission record is written today — the file is absent.
        return []
      }
      return raw.split('\n').flatMap(line => (line.trim() === '' ? [] : [JSON.parse(line) as GrantRecord]))
    },
    () => [],
  )
}

describe('P1-01 step 2: a factory boot records the first-party wildcard grant at startup (red first for B-519)', () => {
  it('① writes a granted admission record for dsh-base naming exactly its eight wildcard tools, each sourced from the install grant table', async () => {
    const records = await bootAndReadAdmissionDecisions()
    const detail = JSON.stringify(records)
    const baseGrant = records.find(record => record.layer === '@deepseek-ai/dsh-base' && record.decision === 'granted')
    // RED today: no startup admission record is written, so there is no dsh-base
    // granted row at all. B-519 records the install grant table.
    expect(baseGrant, detail).toBeDefined()
    const grants = baseGrant?.grants ?? []
    expect([...grants].map(grant => grant.tool).sort(), detail).toEqual([...BASE_WILDCARD_TOOLS].sort())
    expect(grants.every(grant => grant.source === 'install-grant-table'), detail).toBe(true)
    expect(grants.every(grant => (grant.purpose ?? '') !== ''), detail).toBe(true)
  }, LAUNCH_TIMEOUT_MS)
})

/**
 * Stage a loadable package with NO `dsh` manifest, referenced by a cordis row's
 * `name` — a real plugin (`name`/`apply`) that mounts under shadow but is
 * manifest-less, so loading it fails for no reason of its own.
 * @param profileDir - the profile directory.
 * @param name - the package name.
 */
function stageLoadablePackage(profileDir: string, name: string): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: './index.mjs' }))
  writeFileSync(join(pkgDir, 'index.mjs'), `export const name = ${JSON.stringify(name)}\nexport function apply() {}\n`)
}

/** A staged real boot's live context, its home, the captured stderr, and the overlay path (if any). */
interface StagedBoot {
  readonly ctx: Context
  readonly home: string
  readonly stderr: string
  readonly overlayPath: string | undefined
}

/**
 * Stage a factory profile under a fresh `$DSH_HOME` and boot it via `runProfile`
 * at the resolved enforcement (the gate default `'shadow'` with no env set, or
 * the env a case sets), capturing stderr. The caller disposes `ctx`.
 * @param name - the profile name.
 * @param spec - the profile's bundles, root patch, on-disk staging, and optional overlay body.
 * @returns the booted context, its home, the captured stderr, and the overlay path.
 */
async function bootStagedProfile(name: string, spec: {
  readonly bundles: readonly string[]
  readonly rootPatch?: string
  readonly stage?: (profileDir: string) => void
  readonly overlayBody?: string
}): Promise<StagedBoot> {
  const root = mkdtempSync(join(tmpdir(), `p1-01-${name}-`))
  roots.push(root)
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(cwd, { recursive: true })
  const profileDir = join(home, 'profiles', name)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: spec.bundles, patchReload: 'startup', development: true } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), spec.rootPatch ?? '[]\n')
  spec.stage?.(profileDir)
  const patchFiles: string[] = []
  let overlayPath: string | undefined
  if (spec.overlayBody !== undefined) {
    overlayPath = join(root, 'overlay.patch.yml')
    writeFileSync(overlayPath, spec.overlayBody)
    patchFiles.push(overlayPath)
  }
  process.env.DSH_HOME = home
  delete process.env.DSH_TRUST_KERNEL_INSECURE
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  try {
    const { ctx } = await runProfile({
      environment: loadLayeredEnv('dsh', cwd),
      profile: name,
      fromDefaultProfile: undefined,
      patchFiles,
      args: [],
    })
    return { ctx, home, stderr: stderrSpy.mock.calls.map(call => String(call[0])).join(''), overlayPath }
  } finally {
    stderrSpy.mockRestore()
  }
}

describe('P1-01 step 3: on a real factory boot, a patch swapping a manifest-less package into a group is refused (red first for B-519)', () => {
  it('④ a --patch that inserts a group then swaps a manifest-less package into its config does not mount the package, and the refusal names the patch', async () => {
    const boot = await bootStagedProfile('group-swap', {
      bundles: ['@deepseek-ai/dsh-base'],
      stage: (dir) => { stageLoadablePackage(dir, 'manifestless-pkg') },
      // The user --patch inserts a group, then — by id with no name, so it is
      // applied rather than skipped — swaps the group's config to mount a
      // loadable package that declares no manifest. (A rename by id is skipped on
      // a name mismatch, include/src/index.ts:116-118, so it never reaches the
      // mount tree; a config swap by id does.)
      overlayBody:
        '- insert:\n    - id: probe-group\n      name: cordis:group\n      group: true\n'
        + '- id: probe-group\n  config:\n    - id: probe-child\n      name: manifestless-pkg\n',
    })
    const entries = [...boot.ctx.loader.entries()]
    const liveManifestless = entries.some(entry => entry.options.name === 'manifestless-pkg' && entry.fiber !== undefined)
    const stderrNamesPatch = boot.overlayPath !== undefined && boot.stderr.includes(boot.overlayPath)
    const detail = JSON.stringify({ liveManifestless, stderrNamesPatch, names: entries.map(entry => entry.options.name) })
    await boot.ctx.fiber.dispose()
    // RED today: the group's config swap mounts the manifest-less package. B-519
    // refuses swapping a manifest-less package in, so it does not mount.
    expect(liveManifestless, detail).toBe(false)
    // RED today: no refusal is written. B-519 names the patch file (and the row
    // id, package, reason) on stderr when it refuses the swap.
    expect(stderrNamesPatch, detail).toBe(true)
  }, LAUNCH_TIMEOUT_MS)
})

describe('P1-01 step 3: under explicit shadow, a patch inserting a manifest-less package mounts and is shadow-logged (red first for B-519)', () => {
  it('⑥ the inserted package mounts, and shadow-decisions.jsonl records the patch admission', async () => {
    process.env[ENFORCEMENT_ENV] = 'shadow'
    const boot = await bootStagedProfile('insert', {
      bundles: ['@deepseek-ai/dsh-base'],
      stage: (dir) => { stageLoadablePackage(dir, 'manifestless-pkg') },
      overlayBody: '- insert:\n    - id: added-row\n      name: manifestless-pkg\n',
    })
    const entries = [...boot.ctx.loader.entries()]
    const mounted = entries.some(entry =>
      entry.options.id === 'added-row' && entry.options.name === 'manifestless-pkg' && entry.fiber !== undefined)
    let shadowLog: string
    try {
      shadowLog = readFileSync(join(boot.home, 'feature-gates', 'shadow-decisions.jsonl'), 'utf8')
    } catch {
      // No shadow log at all today — treated as "no patch admission recorded".
      shadowLog = ''
    }
    const detail = JSON.stringify({ mounted, shadowHasPatchAdmission: shadowLog.includes('pre-mount-patch-admission') })
    await boot.ctx.fiber.dispose()
    // Green today and after: under explicit shadow the manifest-less insert mounts.
    expect(mounted, detail).toBe(true)
    // RED today: the shadow log records no patch admission; B-519 appends a
    // pre-mount-patch-admission record naming the inserted package.
    expect(shadowLog, detail).toContain('pre-mount-patch-admission')
    expect(shadowLog, detail).toContain('manifestless-pkg')
  }, LAUNCH_TIMEOUT_MS)
})
