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
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_PATCH_RELOAD, initProfile, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { composeProfile, runProfile } from '../src/profile-boot.ts'

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
afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
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
