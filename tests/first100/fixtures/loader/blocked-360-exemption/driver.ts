#!/usr/bin/env node
/**
 * BLOCKED-360 driver for `BLOCKED-360.installation-manifest-exemption.composition.spec.ts`:
 * one real `runProfile` boot per candidate under plugin-manifest enforcement
 * at `enforce`, each in its own child process with its own `DSH_HOME`. A, C
 * and D insert a row naming the same package, and a name resolves to one
 * copy per boot, so the candidates cannot share a profile. The children run
 * in parallel; the parent prints one `BLOCKED-360-EXEMPTION <json>` line with
 * every candidate's result and exits 0.
 *
 * Every candidate's profile composes the default bundles; A to D add one row
 * to the profile's `cordis.patch.yml`:
 * - A names `@deepseek-ai/dsh-code-runtime-worker-thread`, a package with no
 *   Manifest v2 that reaches the installation only through
 *   `@deepseek-ai/dsh-headless`. Nothing is staged: the row resolves through
 *   the installation links the boot keeps in `$DSH_HOME/profiles/node_modules`.
 * - B names a package the installation does not carry, staged without a
 *   manifest in a `node_modules` above `DSH_HOME`, which the profile's
 *   resolution reaches after the installation links.
 * - C stages A's package name in the profile's own `node_modules` as a link
 *   to a manifest-less copy outside the installation.
 * - D stages the same copy there as a real directory.
 * - F adds no row: it observes the base bundle's `tool-web` row, whose
 *   `web_fetch` declares a wildcard destination the installation grants
 *   `@deepseek-ai/dsh-base`.
 * @module tests/first100/fixtures/loader/blocked-360-exemption/driver
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, FiberState } from '@deepseek-ai/cordis'
import { DEFAULT_PROFILE_BUNDLES, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../../../../../apps/cli/src/profile-boot.ts'
import {
  ANCESTOR_ONLY,
  BASE_WILDCARD_GRANT,
  INSTALL_BASE,
  PROFILE_SAME_NAME,
  REPORT_TAG,
  SYMLINK_REALPATH_OUT,
} from './shared.ts'

/** The environment variable a child reads its candidate from. */
const CANDIDATE_ENV = 'BLOCKED_360_CANDIDATE'

/** The line prefix a child reports its one result with. */
const CHILD_MARKER = 'BLOCKED-360-CANDIDATE'

/** The custom profile every candidate boots. */
const PROFILE = 'blocked-360-exemption'

/** The installation package with no Manifest v2 that A mounts and C and D impersonate. */
const INSTALLATION_PACKAGE = '@deepseek-ai/dsh-code-runtime-worker-thread'

/** The package B mounts: a name the installation does not carry. */
const ANCESTOR_PACKAGE = 'blocked-360-ancestor-only'

/** The row each of A to D inserts. */
const SUBJECT_ROW = 'blocked-360-subject'

/** The base bundle's row F observes. */
const GRANTED_ROW = 'tool-web'

/** The candidates, in report order. */
const CANDIDATES = [INSTALL_BASE, ANCESTOR_ONLY, SYMLINK_REALPATH_OUT, PROFILE_SAME_NAME, BASE_WILDCARD_GRANT] as const

/** One child's report. */
interface CandidateResult {
  readonly key: string
  readonly bootSucceeded: boolean
  readonly bootError: string | null
  readonly active: boolean
}

/**
 * Write a manifest-less plugin package.
 * @param dir - the package directory.
 * @param name - the package name.
 * @param key - the candidate the copy belongs to, as the plugin's name.
 */
function stageManifestlessPackage(dir: string, name: string, key: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: './index.mjs' }))
  writeFileSync(join(dir, 'index.mjs'), `export const name = ${JSON.stringify(key)}\nexport function apply() {}\n`)
}

/**
 * Lay out one candidate's profile and anything it stages around it.
 * @param key - the candidate.
 * @param root - the child's own directory, which holds `DSH_HOME`.
 * @param profileDir - the profile directory.
 * @returns the row id the candidate's result reads.
 */
function stageCandidate(key: string, root: string, profileDir: string): string {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...DEFAULT_PROFILE_BUNDLES], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  const insert = (moduleName: string): void => {
    writeFileSync(join(profileDir, 'cordis.patch.yml'), `- insert:\n    - id: ${SUBJECT_ROW}\n      name: '${moduleName}'\n`)
  }
  switch (key) {
    case INSTALL_BASE:
      insert(INSTALLATION_PACKAGE)
      return SUBJECT_ROW
    case ANCESTOR_ONLY:
      stageManifestlessPackage(join(root, 'node_modules', ANCESTOR_PACKAGE), ANCESTOR_PACKAGE, key)
      insert(ANCESTOR_PACKAGE)
      return SUBJECT_ROW
    case SYMLINK_REALPATH_OUT: {
      const outside = join(root, 'outside', 'code-runtime-worker-thread')
      stageManifestlessPackage(outside, INSTALLATION_PACKAGE, key)
      const link = join(profileDir, 'node_modules', INSTALLATION_PACKAGE)
      mkdirSync(dirname(link), { recursive: true })
      symlinkSync(outside, link, 'junction')
      insert(INSTALLATION_PACKAGE)
      return SUBJECT_ROW
    }
    case PROFILE_SAME_NAME:
      stageManifestlessPackage(join(profileDir, 'node_modules', INSTALLATION_PACKAGE), INSTALLATION_PACKAGE, key)
      insert(INSTALLATION_PACKAGE)
      return SUBJECT_ROW
    case BASE_WILDCARD_GRANT:
      writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
      return GRANTED_ROW
    default:
      throw new Error(`blocked-360 driver: unknown candidate ${JSON.stringify(key)}`)
  }
}

/**
 * Boot one candidate in this process and report it on stdout.
 * @param key - the candidate.
 */
async function runCandidate(key: string): Promise<void> {
  const home = process.env.DSH_HOME
  if (home === undefined) throw new Error('blocked-360 child: DSH_HOME is not set')
  const row = stageCandidate(key, dirname(home), resolveProfileDir(PROFILE, home))
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
      && [...ctx.loader.entries()].some(entry => entry.options.id === row && entry.fiber?.state === FiberState.ACTIVE)
    const result: CandidateResult = { key, bootSucceeded: ctx !== undefined, bootError, active }
    process.stdout.write(`${CHILD_MARKER} ${JSON.stringify(result)}\n`)
  } finally {
    if (ctx !== undefined) await ctx.fiber.dispose()
  }
}

/**
 * Run one child for a candidate, with `DSH_HOME` one level below its own
 * directory so B's package sits above it, and read its report.
 * @param key - the candidate.
 * @returns the child's result.
 */
function runChild(key: string): Promise<CandidateResult> {
  const root = mkdtempSync(join(tmpdir(), 'blocked-360-exemption-'))
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
        reject(new Error(`blocked-360: candidate ${key} reported nothing (exit ${String(code)}); stderr tail:\n${stderr.slice(-1200)}`))
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
  const results = await Promise.all(CANDIDATES.map(runChild))
  const failed = results.find(result => !result.bootSucceeded)
  process.stdout.write(`${REPORT_TAG} ${JSON.stringify({
    bootSucceeded: failed === undefined,
    bootError: failed === undefined ? null : `${failed.key}: ${failed.bootError ?? 'unknown'}`,
    candidates: results.map(({ key, active }) => ({ key, active })),
  })}\n`)
}
