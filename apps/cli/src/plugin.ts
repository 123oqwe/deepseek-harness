/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 * @module @deepseek-ai/dsh/plugin
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { classifyPluginDeclaration, evaluatePreMountAdmission } from '@deepseek-ai/dsh-plugin-manifest'
import {
  buildCandidateLock,
  planLockCommit,
  serializeLock,
  summarizeLockCoverage,
  writeLockAtomically,
  type ObservedPackage,
  type PluginLockFile,
} from '@deepseek-ai/dsh-plugin-lock'
import { INSTALL_ANCHOR } from './profile-boot.ts'

const NAME = 'dsh'

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/** The profile-relative path of the plugin lock file. */
const LOCK_FILENAME = 'plugins.lock.json'

/**
 * Read the profile's current lock, or an empty one when it has none.
 *
 * A profile with no lock is the normal starting state, not an error: locking
 * begins the first time `dsh plugin` completes successfully. An unreadable or
 * malformed lock is a different matter and is NOT smoothed over here — it
 * throws, because silently replacing a corrupt lock with a fresh one would
 * destroy the record an operator needs to see.
 * @param profileDir - the profile directory.
 * @returns the current lock, or an empty lock when none exists.
 */
function readCurrentLock(profileDir: string): PluginLockFile {
  const path = join(profileDir, LOCK_FILENAME)
  if (!existsSync(path)) return { lockfileVersion: 1, entries: [], loadOrder: [] }
  return JSON.parse(readFileSync(path, 'utf8')) as PluginLockFile
}

/**
 * Observe every installed dependency of the profile.
 *
 * Reads what an installed directory actually carries. Archive integrity, the
 * source commit, and the signing identity are properties of how a package was
 * PUBLISHED and are recorded only when the package declares them — see
 * `@deepseek-ai/dsh-plugin-lock/candidate`, which marks the rest rather than
 * inventing values.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns one observation per resolvable dependency.
 */
function observeInstalledPackages(profileDir: string): readonly ObservedPackage[] {
  const manifest = readProfileManifest(NAME, profileDir)
  const observed: ObservedPackage[] = []
  for (const packageName of Object.keys(manifest.dependencies ?? {})) {
    let dir: string
    try {
      dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
    } catch {
      continue // unresolvable after a successful install: reconcilePlugins already warned
    }
    const installed = readProfileManifest(NAME, dir) as ProfileManifest & {
      version?: string
      dsh?: { provenance?: { integrity?: string, sourceCommit?: string, signatureIdentity?: string } }
    }
    const provenance = installed.dsh?.provenance
    observed.push({
      name: packageName,
      version: installed.version ?? '0.0.0',
      manifest: installed,
      dependencies: Object.keys(installed.dependencies ?? {}),
      grantedCapabilities: [],
      ...(provenance?.integrity === undefined ? {} : { integrity: provenance.integrity }),
      ...(provenance?.sourceCommit === undefined ? {} : { sourceCommit: provenance.sourceCommit }),
      ...(provenance?.signatureIdentity === undefined ? {} : { signatureIdentity: provenance.signatureIdentity }),
    })
  }
  return observed
}

/**
 * Generate, verify, and atomically install a new lock (must[1]).
 *
 * Runs only after pnpm reported success, so the observed install is the one
 * that actually landed. The candidate is validated before it replaces
 * anything, and the replacement is a rename, so a failure at any point leaves
 * the previous lock exactly as it was.
 *
 * A refusal is reported and does NOT fail the command: the packages are
 * already installed at this point, and exiting non-zero would tell the user
 * their install failed when what failed is the record of it. The distinction
 * is stated in the message.
 * @param profileDir - the profile directory.
 */
function commitProfileLock(profileDir: string): void {
  const current = readCurrentLock(profileDir)
  const candidate = buildCandidateLock(observeInstalledPackages(profileDir))
  if (candidate === undefined) {
    process.stderr.write(`${NAME}: lock: not written — the installed dependency graph contains a cycle\n`)
    return
  }
  const decision = planLockCommit(current, candidate, current)
  if (!decision.committed) {
    process.stderr.write(`${NAME}: lock: not written (${decision.reason}) — ${decision.detail}\n`)
    process.stderr.write(`${NAME}: lock: the plugins ARE installed; only the lock record was refused\n`)
    return
  }
  if (serializeLock(current) === serializeLock(decision.lock)) return
  writeLockAtomically(join(profileDir, LOCK_FILENAME), decision.lock)
  const coverage = summarizeLockCoverage(decision.lock)
  if (coverage.unavailable > 0) {
    // Saying "locked" without saying how much of it is real would overstate
    // the file: an entry whose integrity is a marker pins no archive.
    process.stderr.write(
      `${NAME}: lock: wrote ${LOCK_FILENAME} — ${coverage.observed} observed fact(s), `
      + `${coverage.unavailable} unavailable (packages declaring no provenance)\n`,
    )
  }
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[profile]
    initProfile(
      dir,
      template?.bundles ?? DEFAULT_PROFILE_BUNDLES,
      template?.patchReload,
    )
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  const result = spawnSync('pnpm', args.map(argument => anchorPathSpec(argument, process.cwd())), {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  const exitCode = result.status ?? 1
  if (exitCode === 0) {
    reconcilePlugins(before, dir)
    commitProfileLock(dir)
  } else {
    // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
    // one; the profile owns it, and the commonest failure here is pnpm ≥10
    // blocking a git dependency's prepare (build) script until allowlisted.
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
    if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
      process.stderr.write(
        `${NAME}: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — `
        + `add the exact key pnpm printed above under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}, then re-run\n`,
      )
    }
  }
  return exitCode
}

/**
 * `dsh plugin verify <fixture>` (registry `verifyCommand`, run as
 * `pnpm plugin:verify <fixture>`): validate one fixture file as a
 * `package.json` `dsh` field and report exactly what a production profile
 * boot would decide for it (Epic P1-01.U's must[3]/acceptance[0]/
 * acceptance[3]) — the same {@link classifyPluginDeclaration}/
 * {@link evaluatePreMountAdmission} pair `packages/boot/app-boot/src/profile.ts`'s
 * `partitionProfileLayersByAdmission` calls at real profile boot, run here
 * against one fixture with no profile or Loader involved. `production: true`
 * always: verifying a fixture answers "would this be admitted in
 * production," the only question this command exists to answer.
 * @param fixturePath - path to a JSON file holding a `dsh` field value (see
 * `packages/plugin/plugin-manifest/tests/fixtures/*.json` for the exact shape).
 * @returns `0` when the fixture would be admitted, `1` when denied or unreadable.
 */
export function runPluginVerify(fixturePath: string): number {
  let dshField: unknown
  try {
    dshField = JSON.parse(readFileSync(resolve(fixturePath), 'utf8'))
  } catch (error) {
    process.stderr.write(`${NAME}: plugin verify: cannot read fixture ${JSON.stringify(fixturePath)}: ${String(error)}\n`)
    return 1
  }
  const declaration = classifyPluginDeclaration(dshField)
  const admission = evaluatePreMountAdmission(declaration, true)
  process.stdout.write(`${NAME}: plugin verify: ${JSON.stringify(fixturePath)} classified as ${JSON.stringify(declaration.kind)}\n`)
  if (admission.admitted) {
    process.stdout.write(`${NAME}: plugin verify: ADMITTED — would be composed into a production profile\n`)
    return 0
  }
  process.stdout.write(`${NAME}: plugin verify: DENIED (${admission.reason})`
    + (admission.wildcardFindings.length > 0 ? ` — wildcard findings: ${admission.wildcardFindings.map(finding => `${finding.path}=${JSON.stringify(finding.pattern)}`).join(', ')}` : '')
    + ' — would be excluded from a production profile at pre-mount admission\n')
  return 1
}
