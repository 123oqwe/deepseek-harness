#!/usr/bin/env node
/**
 * BLOCKED-359 driver for `BLOCKED-359.live-reload-lock-gate.composition.spec.ts`:
 * one real `runProfile` boot of a `patchReload: 'live'` profile per scenario,
 * each in its own child process with its own `DSH_HOME`, followed by one edit
 * of that profile's `cordis.patch.yml` that the real HMR watcher reloads. The
 * children run in parallel; the parent prints one `BLOCKED-359-RELOAD-LOCK
 * <json>` line with every scenario's result and exits 0.
 *
 * Every scenario boots the same profile: the shipped base bundle in its
 * default production posture, an empty user layer, and a committed
 * `plugins.lock.json`. `LOCKED_PKG` is installed the way `dsh plugin add`
 * leaves a package — listed as a dependency, recorded with an integrity in the
 * profile's `pnpm-lock.yaml`, and approved by the lock — so the boot's lock
 * gate admits the profile. `UNLOCKED_PKG` sits in the profile's
 * `node_modules` only: listed as a dependency it would refuse the boot itself.
 * Both carry the same valid Manifest v2, so only lock membership tells them
 * apart. The lock is committed through the plugin-lock functions `dsh plugin`
 * uses (`buildCandidateLock`, `planLockCommit`, `writeLockAtomically`).
 *
 * After boot each child writes one edit that disables the base `logger-stderr`
 * row and inserts its scenario's package, then reports what the shipped `ctx`
 * shows once the reload settles: loader entries and any
 * `hmr/config-update-failed` event for the profile's patch file. Nothing here
 * passes a lock policy.
 * @module tests/first100/fixtures/loader/blocked-359-live-reload-lock-gate/driver
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-hmr'
import { loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { buildCandidateLock, planLockCommit, type PluginLockFile, writeLockAtomically } from '@deepseek-ai/dsh-plugin-lock'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import { CONTROL, LOCKED_PKG, MAIN_RED, PROBE_BASE_ROW, REPORT_TAG, UNLOCKED_PKG } from './shared.ts'

/** The environment variable a child reads its scenario from. */
const SCENARIO_ENV = 'BLOCKED_359_RELOAD_LOCK_SCENARIO'

/** The line prefix a child reports its one result with. */
const CHILD_MARKER = 'BLOCKED-359-RELOAD-LOCK-SCENARIO'

/** The custom profile every scenario boots. */
const PROFILE = 'blocked-359-live-reload'

/** The row id the live edit inserts the scenario's package under. */
const SUBJECT_ROW = 'blocked-359-subject'

/** The tool both packages declare and register. */
const PROBE_TOOL = 'blocked_359_probe'

/** The version every staged package is installed at. */
const VERSION = '1.0.0'

/** The integrity the install records for `LOCKED_PKG`. */
const INTEGRITY = `sha512-${'a'.repeat(86)}==`

/**
 * How long a child waits for the reload to show on any channel. The whole
 * smoke process has 30 seconds, boot included, so a reload that never shows is
 * reported as `reloadSettled: false` rather than killed with the process.
 */
const SETTLE_TIMEOUT_MS = 10_000

/** Every scenario, in the order the report lists them. */
const SCENARIOS = [MAIN_RED, CONTROL] as const

/** One scenario's boot and reload, as the spec reads it. */
interface ScenarioResult {
  readonly scenario: string
  readonly unlockedMounted: boolean
  readonly lockedMounted: boolean
  readonly loggerPreserved: boolean
  readonly failureEventSeen: boolean
  readonly reloadSettled: boolean
}

/**
 * The `package.json` a subject package is installed with: a Manifest v2 that
 * declares the one tool its entry registers.
 * @param name - the package name.
 * @returns the manifest.
 */
function manifestOf(name: string): Record<string, unknown> {
  return {
    name,
    version: VERSION,
    type: 'module',
    main: './index.mjs',
    dsh: {
      manifestVersion: 2,
      tools: [{ name: PROBE_TOOL, sideEffectClass: 'none', authAudience: ['model'], allowedDestinations: [], dataClassification: 'internal' }],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
    },
  }
}

/**
 * Stage one subject package under the profile's own `node_modules`; its entry
 * labels one `tools.register` effect.
 * @param profileDir - the profile directory.
 * @param name - the package name.
 */
function stagePackage(profileDir: string, name: string): void {
  const dir = join(profileDir, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifestOf(name))}\n`)
  writeFileSync(join(dir, 'index.mjs'), [
    'export function apply(ctx) {',
    `  ctx.effect(function* () { yield () => {} }, 'tools.register(${JSON.stringify(PROBE_TOOL)})')`,
    '}',
    '',
  ].join('\n'))
}

/**
 * Stage the profile every scenario boots: the base bundle with live reload, an
 * empty user layer, both subject packages, `LOCKED_PKG` installed as a
 * dependency with its `pnpm-lock.yaml` record, and the committed lock.
 * @param profileDir - the profile directory.
 */
async function stageProfile(profileDir: string): Promise<void> {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dependencies: { [LOCKED_PKG]: VERSION },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'live' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  stagePackage(profileDir, LOCKED_PKG)
  stagePackage(profileDir, UNLOCKED_PKG)
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    `      ${LOCKED_PKG}:\n        specifier: ${VERSION}\n        version: ${VERSION}`,
    '',
    'packages:',
    '',
    `  ${LOCKED_PKG}@${VERSION}:\n    resolution: {integrity: ${INTEGRITY}}`,
    '',
    // pnpm's reader returns no packages at all when `snapshots:` is absent.
    'snapshots:',
    '',
    `  ${LOCKED_PKG}@${VERSION}: {}`,
    '',
  ].join('\n'))
  const empty: PluginLockFile = { lockfileVersion: 1, entries: [], loadOrder: [] }
  const candidate = buildCandidateLock([{
    name: LOCKED_PKG,
    version: VERSION,
    manifest: manifestOf(LOCKED_PKG),
    dependencies: [],
    grantedCapabilities: [],
    integrity: INTEGRITY,
  }])
  if (candidate === undefined) throw new Error('blocked-359 fixture: the observed install has a dependency cycle')
  const decision = planLockCommit(empty, candidate, empty)
  if (!decision.committed) throw new Error(`blocked-359 fixture: the lock was not committed (${decision.reason}): ${decision.detail}`)
  await writeLockAtomically(join(profileDir, 'plugins.lock.json'), decision.lock)
}

/**
 * The live loader entry under an id.
 * @param ctx - the booted context.
 * @param id - the row id.
 * @returns the entry, when the tree holds one.
 */
function entry(ctx: Context, id: string): { readonly fiber: { readonly state: FiberState } | undefined; readonly name: unknown } | undefined {
  const found = [...ctx.loader.entries()].find(item => item.options.id === id)
  return found === undefined ? undefined : { fiber: found.fiber, name: found.options.name }
}

/**
 * Poll `test` until it holds or the deadline passes.
 * @param test - the condition.
 * @returns whether it held before the deadline.
 */
async function eventually(test: () => boolean): Promise<boolean> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  while (!test()) {
    if (Date.now() >= deadline) return false
    await new Promise(settle => setTimeout(settle, 25))
  }
  return true
}

/**
 * Boot one scenario in this process, apply its live edit, and report it on stdout.
 * @param scenario - the scenario id.
 */
async function runScenario(scenario: string): Promise<void> {
  const home = process.env.DSH_HOME
  if (home === undefined) throw new Error('blocked-359 child: DSH_HOME is not set')
  if (scenario !== MAIN_RED && scenario !== CONTROL) throw new Error(`blocked-359 child: unknown scenario ${JSON.stringify(scenario)}`)
  const subject = scenario === MAIN_RED ? UNLOCKED_PKG : LOCKED_PKG
  const profileDir = resolveProfileDir(PROFILE, home)
  await stageProfile(profileDir)
  const { ctx } = await runProfile({
    environment: loadLayeredEnv('dsh', process.cwd()),
    profile: PROFILE,
    fromDefaultProfile: undefined,
    patchFiles: [],
    args: [],
  })
  try {
    if (entry(ctx, PROBE_BASE_ROW)?.fiber === undefined) throw new Error(`blocked-359 child: ${PROBE_BASE_ROW} did not mount at boot`)
    if (entry(ctx, SUBJECT_ROW) !== undefined) throw new Error(`blocked-359 child: ${SUBJECT_ROW} exists before the live edit`)
    const patchPath = join(profileDir, 'cordis.patch.yml')
    const failures: { readonly filename: string }[] = []
    ctx.on('hmr/config-update-failed', (filename) => {
      failures.push({ filename })
    })
    writeFileSync(patchPath, [
      `- id: ${PROBE_BASE_ROW}`,
      '  disabled: true',
      '- insert:',
      `    - id: ${SUBJECT_ROW}`,
      `      name: ${subject}`,
      '',
    ].join('\n'))
    const reloadSettled = await eventually(() => failures.length > 0
      || entry(ctx, SUBJECT_ROW)?.fiber !== undefined
      || entry(ctx, PROBE_BASE_ROW)?.fiber === undefined)
    await ctx.loader.await()
    const mounted = entry(ctx, SUBJECT_ROW)
    const active = mounted?.fiber?.state === FiberState.ACTIVE
    const result: ScenarioResult = {
      scenario,
      unlockedMounted: active && mounted?.name === UNLOCKED_PKG,
      lockedMounted: active && mounted?.name === LOCKED_PKG,
      loggerPreserved: entry(ctx, PROBE_BASE_ROW)?.fiber !== undefined,
      failureEventSeen: failures.some(failure => failure.filename === patchPath),
      reloadSettled,
    }
    process.stdout.write(`${CHILD_MARKER} ${JSON.stringify(result)}\n`)
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * Run one child for a scenario, with its own `DSH_HOME`, and read its report.
 * @param scenario - the scenario id.
 * @returns the child's result.
 */
function runChild(scenario: string): Promise<ScenarioResult> {
  const home = mkdtempSync(join(tmpdir(), 'blocked-359-reload-home-'))
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
        reject(new Error(`blocked-359: scenario ${scenario} reported nothing (exit ${String(code)}); stderr tail:\n${stderr.slice(-1200)}`))
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
  process.stdout.write(`${REPORT_TAG} ${JSON.stringify({ scenarios })}\n`)
}
