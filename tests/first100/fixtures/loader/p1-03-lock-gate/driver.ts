#!/usr/bin/env node
/**
 * A-550 driver for `P1-03.lock-gate-boot.composition.spec.ts`: one real
 * `runProfile` boot per scenario, each in its own child process with its own
 * `DSH_HOME`, because a refused boot ends the whole start and one process
 * cannot hold six independent boots. The children run in parallel; the parent
 * prints one `P1-03-LOCK-GATE <json>` line with every scenario's result and
 * exits 0.
 *
 * Each profile is built the way `dsh plugin add` leaves one: the bundles a
 * custom profile starts from (`DEFAULT_PROFILE_BUNDLES`, resolved from the
 * installation) plus a subject bundle package in the profile's own
 * `node_modules`, listed as a dependency and recorded with an integrity in the
 * profile's `pnpm-lock.yaml`. A locked profile's `plugins.lock.json` is
 * committed through the plugin-lock functions `dsh plugin` uses
 * (`buildCandidateLock`, `planLockCommit`, `writeLockAtomically`); no lock is
 * hand-written. The installation's own bundles are the shipped bundles C17
 * option 2′ exempts: they get no lock entry. `SHIPPED_EXEMPT_BUNDLE` is not
 * staged, because a test cannot add a package to the installation.
 *
 * Nothing here passes a lock policy: the boot reads it from the bundles.
 * @module tests/first100/fixtures/loader/p1-03-lock-gate/driver
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, FiberState } from '@deepseek-ai/cordis'
import { DEFAULT_PROFILE_BUNDLES, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { buildCandidateLock, planLockCommit, type PluginLockFile, writeLockAtomically } from '@deepseek-ai/dsh-plugin-lock'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import {
  CONTROL_LOCKED,
  CONTROL_ORDINARY_DEP,
  DRIFTED_PLUGIN,
  INSTALLED_NOT_IN_LOCK,
  INTEGRITY_MISMATCH,
  INTEGRITY_PLUGIN,
  LOCK_GATE_MARKER,
  LOCK_GATE_TOOL,
  LOCKED_PLUGIN,
  MANIFEST_DRIFTED,
  NO_LOCK_POLICY,
  NOLOCK_PLUGIN,
  ORDINARY_DEP_PLUGIN,
  UNLOCKED_PLUGIN,
} from './shared.ts'

/** The environment variable a child reads its scenario from. */
const SCENARIO_ENV = 'P1_03_LOCK_GATE_SCENARIO'

/** The line prefix a child reports its one result with. */
const CHILD_MARKER = 'P1-03-LOCK-GATE-SCENARIO'

/** The custom profile every scenario boots. */
const PROFILE = 'p1-03-lock-gate'

/** The version every staged package is installed at. */
const VERSION = '1.0.0'

/** The integrity the install records, and a different one for the mismatch scenario. */
const INTEGRITY = `sha512-${'a'.repeat(86)}==`
const OTHER_INTEGRITY = `sha512-${'b'.repeat(86)}==`

/** A plain library installed beside a plugin: a dependency the lock records, not a bundle. */
const PLAIN_LIBRARY = 'dsh-p1-03-plain-library'

/** Every scenario, in the order the report lists them. */
const SCENARIOS = [CONTROL_LOCKED, CONTROL_ORDINARY_DEP, INSTALLED_NOT_IN_LOCK, MANIFEST_DRIFTED, INTEGRITY_MISMATCH, NO_LOCK_POLICY] as const

/** One scenario's boot, as the spec reads it. */
interface ScenarioResult {
  readonly scenario: string
  readonly bootSucceeded: boolean
  readonly bootError: string | null
  readonly subjectActive: boolean
}

/**
 * The `package.json` a subject bundle is installed with: a bundle layer whose
 * Manifest v2 declares the one tool its entry registers, so plugin manifest
 * enforcement admits it under any default.
 * @param name - the package name.
 * @returns the manifest.
 */
function bundleManifestOf(name: string): Record<string, unknown> {
  return {
    name,
    version: VERSION,
    type: 'module',
    main: './index.mjs',
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      manifestVersion: 2,
      tools: [{ name: LOCK_GATE_TOOL, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal' }],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    },
  }
}

/**
 * The `package.json` a plain library is installed with: it declares no bundle.
 * @param name - the package name.
 * @returns the manifest.
 */
function plainManifestOf(name: string): Record<string, unknown> {
  return { name, version: VERSION, type: 'module', main: './index.mjs' }
}

/**
 * Stage one subject bundle under the profile's own `node_modules`; its entry
 * labels one `tools.register` effect.
 * @param profileDir - the profile directory.
 * @param name - the package name.
 */
function stageBundle(profileDir: string, name: string): void {
  const dir = join(profileDir, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(bundleManifestOf(name))}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${name}-row\n      name: ${name}\n`)
  writeFileSync(join(dir, 'index.mjs'), [
    'export function apply(ctx) {',
    `  ctx.effect(function* () { yield () => {} }, 'tools.register(${JSON.stringify(LOCK_GATE_TOOL)})')`,
    '}',
    '',
  ].join('\n'))
}

/**
 * Stage one plain library under the profile's own `node_modules`.
 * @param profileDir - the profile directory.
 * @param name - the package name.
 */
function stagePlain(profileDir: string, name: string): void {
  const dir = join(profileDir, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(plainManifestOf(name))}\n`)
  writeFileSync(join(dir, 'index.mjs'), 'export {}\n')
}

/**
 * Write the profile `dsh plugin add` leaves: a manifest listing the installed
 * packages as dependencies and composing the subject after the shipped
 * bundles, an empty user layer, and the install's `pnpm-lock.yaml`.
 * @param profileDir - the profile directory.
 * @param subject - the subject bundle.
 * @param plain - the installed plain libraries.
 * @param integrity - the integrity the install records for every package.
 */
function stageProfile(profileDir: string, subject: string, plain: readonly string[], integrity: string): void {
  mkdirSync(profileDir, { recursive: true })
  const installed = [subject, ...plain]
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dependencies: Object.fromEntries(installed.map(name => [name, VERSION] as const)),
    dsh: { profile: { bundles: [...DEFAULT_PROFILE_BUNDLES, subject], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  stageBundle(profileDir, subject)
  for (const name of plain) stagePlain(profileDir, name)
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    ...installed.map(name => `      ${name}:\n        specifier: ${VERSION}\n        version: ${VERSION}`),
    '',
    'packages:',
    '',
    ...installed.map(name => `  ${name}@${VERSION}:\n    resolution: {integrity: ${integrity}}`),
    '',
    // pnpm's reader returns no packages at all when `snapshots:` is absent.
    'snapshots:',
    '',
    ...installed.map(name => `  ${name}@${VERSION}: {}`),
    '',
  ].join('\n'))
}

/**
 * Commit a lock for the given packages as `dsh plugin` does: a candidate built
 * from the install as observed, validated against the empty lock a profile
 * starts with, and written atomically.
 * @param profileDir - the profile directory.
 * @param bundles - the subject bundles to lock.
 * @param plain - the plain libraries to lock.
 */
async function lockProfile(profileDir: string, bundles: readonly string[], plain: readonly string[]): Promise<void> {
  const empty: PluginLockFile = { lockfileVersion: 1, entries: [], loadOrder: [] }
  const observed = [
    ...bundles.map(name => ({ name, manifest: bundleManifestOf(name) })),
    ...plain.map(name => ({ name, manifest: plainManifestOf(name) })),
  ]
  const candidate = buildCandidateLock(observed.map(({ name, manifest }) => ({
    name,
    version: VERSION,
    manifest,
    dependencies: [],
    grantedCapabilities: [],
    integrity: INTEGRITY,
  })))
  if (candidate === undefined) throw new Error('p1-03 lock gate fixture: the observed install has a dependency cycle')
  const decision = planLockCommit(empty, candidate, empty)
  if (!decision.committed) throw new Error(`p1-03 lock gate fixture: the lock was not committed (${decision.reason}): ${decision.detail}`)
  await writeLockAtomically(join(profileDir, 'plugins.lock.json'), decision.lock)
}

/**
 * Stage one scenario's profile.
 * @param scenario - the scenario id.
 * @param profileDir - the profile directory.
 * @returns the subject bundle whose activity the scenario reports.
 */
async function stageScenario(scenario: string, profileDir: string): Promise<string> {
  switch (scenario) {
    case CONTROL_LOCKED:
      stageProfile(profileDir, LOCKED_PLUGIN, [], INTEGRITY)
      await lockProfile(profileDir, [LOCKED_PLUGIN], [])
      return LOCKED_PLUGIN
    case CONTROL_ORDINARY_DEP:
      stageProfile(profileDir, ORDINARY_DEP_PLUGIN, [PLAIN_LIBRARY], INTEGRITY)
      await lockProfile(profileDir, [ORDINARY_DEP_PLUGIN], [PLAIN_LIBRARY])
      return ORDINARY_DEP_PLUGIN
    case INSTALLED_NOT_IN_LOCK:
      // A lock exists and records the plain library, but not the bundle installed beside it.
      stageProfile(profileDir, UNLOCKED_PLUGIN, [PLAIN_LIBRARY], INTEGRITY)
      await lockProfile(profileDir, [], [PLAIN_LIBRARY])
      return UNLOCKED_PLUGIN
    case MANIFEST_DRIFTED: {
      stageProfile(profileDir, DRIFTED_PLUGIN, [], INTEGRITY)
      await lockProfile(profileDir, [DRIFTED_PLUGIN], [])
      // The manifest changes after the lock was written.
      writeFileSync(
        join(profileDir, 'node_modules', DRIFTED_PLUGIN, 'package.json'),
        `${JSON.stringify({ ...bundleManifestOf(DRIFTED_PLUGIN), description: 'changed after the lock was written' })}\n`,
      )
      return DRIFTED_PLUGIN
    }
    case INTEGRITY_MISMATCH:
      // The lock records INTEGRITY; the install recorded a different one.
      stageProfile(profileDir, INTEGRITY_PLUGIN, [], OTHER_INTEGRITY)
      await lockProfile(profileDir, [INTEGRITY_PLUGIN], [])
      return INTEGRITY_PLUGIN
    case NO_LOCK_POLICY:
      stageProfile(profileDir, NOLOCK_PLUGIN, [], INTEGRITY)
      return NOLOCK_PLUGIN
    default:
      throw new Error(`p1-03 lock gate fixture: unknown scenario ${JSON.stringify(scenario)}`)
  }
}

/**
 * Boot one scenario in this process and report it on stdout.
 * @param scenario - the scenario id.
 */
async function runScenario(scenario: string): Promise<void> {
  const home = process.env.DSH_HOME
  if (home === undefined) throw new Error('p1-03 lock gate child: DSH_HOME is not set')
  const subject = await stageScenario(scenario, resolveProfileDir(PROFILE, home))
  let ctx: Context | undefined
  let bootError: string | null = null
  try {
    ctx = (await runProfile({
      environment: loadLayeredEnv('dsh', process.cwd()),
      profile: PROFILE,
      fromDefaultProfile: undefined,
      patchFiles: [],
      args: [],
    })).ctx
  } catch (error) {
    bootError = error instanceof Error ? error.message : String(error)
  }
  try {
    const subjectActive = ctx !== undefined
      && [...ctx.loader.entries()].some(entry => entry.options.name === subject && entry.fiber?.state === FiberState.ACTIVE)
    const result: ScenarioResult = { scenario, bootSucceeded: ctx !== undefined, bootError, subjectActive }
    process.stdout.write(`${CHILD_MARKER} ${JSON.stringify(result)}\n`)
  } finally {
    if (ctx !== undefined) await ctx.fiber.dispose()
  }
}

/**
 * Run one child for a scenario, with its own `DSH_HOME`, and read its report.
 * @param scenario - the scenario id.
 * @returns the child's result.
 */
function runChild(scenario: string): Promise<ScenarioResult> {
  const home = mkdtempSync(join(tmpdir(), 'p1-03-lock-gate-home-'))
  return new Promise<ScenarioResult>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', [SCENARIO_ENV]: scenario },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      rmSync(home, { recursive: true, force: true })
      const json = new RegExp(`${CHILD_MARKER} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
      if (json === undefined) {
        reject(new Error(`p1-03 lock gate: scenario ${scenario} reported nothing (exit ${String(code)}); stderr tail:\n${stderr.slice(-1200)}`))
        return
      }
      resolve(JSON.parse(json) as ScenarioResult)
    })
  })
}

const scenario = process.env[SCENARIO_ENV]
if (scenario !== undefined) {
  await runScenario(scenario)
  process.exit(0)
} else {
  const scenarios = await Promise.all(SCENARIOS.map(runChild))
  process.stdout.write(`${LOCK_GATE_MARKER} ${JSON.stringify({ scenarios })}\n`)
}
