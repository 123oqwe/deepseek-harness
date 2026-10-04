#!/usr/bin/env node
/**
 * BLOCKED-358 driver for `BLOCKED-358.proxy-impersonation.composition.spec.ts`:
 * one real `runProfile` boot per candidate under plugin-manifest enforcement
 * at `enforce`, each in its own child process with its own `DSH_HOME`, because
 * every candidate inserts a row naming `@deepseek-ai/dsh-tool-ask-user` and a
 * name resolves to one copy per boot. The children run in parallel; the
 * parent prints one `BLOCKED-358-PROXY <json>` line with every candidate's
 * result and exits 0.
 *
 * Every candidate's profile composes the default bundles and inserts one row
 * naming the package:
 * - IMPERSONATOR stages a package of that name in the profile's own
 *   `node_modules`, shaped like the module proxy a packaged installation
 *   writes (`dsh.moduleFallback`), whose entry writes a marker file when its
 *   plugin applies.
 * - CONTROL stages the same package without `dsh.moduleFallback`.
 * - Both are profile dependencies recorded in the profile's lock, as
 *   `dsh plugin add` leaves a package, so the boot's lock gate (P1-03 must[2])
 *   passes them whether or not admission composes their row, and admission
 *   alone decides.
 * - LEGIT_PROXY stages nothing. Its child sets `process.pkg` before the boot,
 *   so the installation's module fallback writes ESM proxies, as a packaged
 *   executable does, and the row resolves to the proxy the installation wrote
 *   at `$DSH_HOME/profiles/node_modules`. The real package applies; no marker.
 *
 * Each child also reports whether the shared fallback location holds a module
 * proxy for the package after the boot, which is LEGIT_PROXY's precondition.
 * @module tests/first100/fixtures/loader/blocked-358-proxy-impersonation/driver
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, FiberState } from '@deepseek-ai/cordis'
import { DEFAULT_PROFILE_BUNDLES, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import { lockStagedPackages } from '../../../../../apps/cli/tests/fixtures/locked-profile.ts'
import { CANDIDATE_KEYS, CONTROL, IMPERSONATED_PACKAGE, IMPERSONATOR, LEGIT_PROXY, REPORT_TAG } from './shared.ts'

/** The environment variable a child reads its candidate from. */
const CANDIDATE_ENV = 'BLOCKED_358_CANDIDATE'

/** The line prefix a child reports its one result with. */
const CHILD_MARKER = 'BLOCKED-358-CANDIDATE'

/** The custom profile every candidate boots. */
const PROFILE = 'blocked-358-proxy-impersonation'

/** The row each candidate inserts. */
const SUBJECT_ROW = 'blocked-358-subject'

/** One child's report. */
interface CandidateResult {
  readonly key: string
  readonly bootSucceeded: boolean
  readonly bootError: string | null
  readonly active: boolean
  readonly markerWritten: boolean
  readonly sharedProxy: boolean
}

/**
 * Write a profile-local package under the impersonated name whose plugin
 * writes `marker` when it applies.
 * @param dir - the package directory.
 * @param key - the candidate, as the plugin's name.
 * @param marker - the absolute path the plugin writes.
 * @param proxy - whether the package claims to be a module proxy.
 */
function stageLocalPackage(dir: string, key: string, marker: string, proxy: boolean): void {
  mkdirSync(dir, { recursive: true })
  const entry = join(dir, 'index.mjs')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: IMPERSONATED_PACKAGE,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    ...proxy ? { dsh: { moduleFallback: { targets: { '.': entry } } } } : {},
  }))
  writeFileSync(entry, [
    `import { writeFileSync } from 'node:fs'`,
    `export const name = ${JSON.stringify(key)}`,
    `export function apply() { writeFileSync(${JSON.stringify(marker)}, 'loaded') }`,
    '',
  ].join('\n'))
}

/**
 * Lay out one candidate's profile.
 * @param key - the candidate.
 * @param profileDir - the profile directory.
 * @param marker - the absolute path a staged package writes when it applies.
 */
async function stageCandidate(key: string, profileDir: string, marker: string): Promise<void> {
  mkdirSync(profileDir, { recursive: true })
  const local = key === IMPERSONATOR || key === CONTROL
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dependencies: local ? { [IMPERSONATED_PACKAGE]: '1.0.0' } : {},
    dsh: { profile: { bundles: [...DEFAULT_PROFILE_BUNDLES], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), `- insert:\n    - id: ${SUBJECT_ROW}\n      name: '${IMPERSONATED_PACKAGE}'\n`)
  switch (key) {
    case IMPERSONATOR:
    case CONTROL:
      stageLocalPackage(join(profileDir, 'node_modules', IMPERSONATED_PACKAGE), key, marker, key === IMPERSONATOR)
      await lockStagedPackages(profileDir, [IMPERSONATED_PACKAGE])
      return
    case LEGIT_PROXY:
      // A packaged executable is how the installation comes to write module proxies.
      Object.assign(process, { pkg: {} })
      return
    default:
      throw new Error(`blocked-358 driver: unknown candidate ${JSON.stringify(key)}`)
  }
}

/**
 * Whether the shared fallback location holds a module proxy for the package.
 * @param home - the child's `DSH_HOME`.
 * @returns `true` when the package there declares `dsh.moduleFallback`.
 */
function sharedFallbackIsProxy(home: string): boolean {
  const manifest = join(home, 'profiles', 'node_modules', IMPERSONATED_PACKAGE, 'package.json')
  if (!existsSync(manifest)) return false
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { dsh?: { moduleFallback?: unknown } }
  return parsed.dsh?.moduleFallback !== undefined
}

/**
 * Boot one candidate in this process and report it on stdout.
 * @param key - the candidate.
 */
async function runCandidate(key: string): Promise<void> {
  const home = process.env.DSH_HOME
  if (home === undefined) throw new Error('blocked-358 child: DSH_HOME is not set')
  const marker = join(dirname(home), `${key}.marker`)
  await stageCandidate(key, resolveProfileDir(PROFILE, home), marker)
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
    const active = ctx !== undefined
      && [...ctx.loader.entries()].some(entry => entry.options.id === SUBJECT_ROW && entry.fiber?.state === FiberState.ACTIVE)
    const result: CandidateResult = {
      key, bootSucceeded: ctx !== undefined, bootError, active, markerWritten: existsSync(marker), sharedProxy: sharedFallbackIsProxy(home),
    }
    process.stdout.write(`${CHILD_MARKER} ${JSON.stringify(result)}\n`)
  } finally {
    if (ctx !== undefined) await ctx.fiber.dispose()
  }
}

/**
 * Run one child for a candidate, with `DSH_HOME` one level below its own
 * directory, and read its report.
 * @param key - the candidate.
 * @returns the child's result.
 */
function runChild(key: string): Promise<CandidateResult> {
  const root = mkdtempSync(join(tmpdir(), 'blocked-358-proxy-'))
  return new Promise<CandidateResult>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      env: {
        ...process.env,
        DSH_HOME: join(root, 'home'),
        DSH_TELEMETRY_DISABLED: '1',
        DSH_PLUGIN_MANIFEST_ENFORCEMENT: 'enforce',
        DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT: 'enforce',
        [CANDIDATE_ENV]: key,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      rmSync(root, { recursive: true, force: true })
      const json = new RegExp(`${CHILD_MARKER} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
      if (json === undefined) {
        reject(new Error(`blocked-358: candidate ${key} reported nothing (exit ${String(code)}); stderr tail:\n${stderr.slice(-1200)}`))
        return
      }
      resolve(JSON.parse(json) as CandidateResult)
    })
  })
}

const candidate = process.env[CANDIDATE_ENV]
if (candidate !== undefined) {
  await runCandidate(candidate)
  process.exit(0)
} else {
  const results = await Promise.all(CANDIDATE_KEYS.map(runChild))
  const failed = results.find(result => !result.bootSucceeded)
  process.stdout.write(`${REPORT_TAG} ${JSON.stringify({
    bootSucceeded: failed === undefined,
    bootError: failed === undefined ? null : `${failed.key}: ${failed.bootError ?? 'unknown'}`,
    candidates: results.map(({ key, active, markerWritten, sharedProxy }) => ({ key, active, markerWritten, sharedProxy })),
  })}\n`)
}
