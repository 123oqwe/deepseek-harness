/**
 * B-669, the P1-03 red first (the P1-03 row of the acceptance locks): a real
 * `dsh --profile` launch refuses to start when the profile's plugin lock does
 * not match the plugins its own directory holds, and an unlocked profile does
 * what the shipped bundles declare for it.
 *
 * Each case launches the real `dsh` bin once, through the shared launcher,
 * against its own `DSH_HOME` and a profile built the way `dsh plugin add`
 * leaves one: the bundles a custom profile starts from
 * (`DEFAULT_PROFILE_BUNDLES`, resolved from the installation) plus third-party
 * bundle packages in the profile's own `node_modules`, listed as its
 * dependencies, recorded in its `pnpm-lock.yaml`, and locked in its
 * `plugins.lock.json` by the functions `dsh plugin` commits a lock with. Under
 * C17 option 2′ the lock holds only the packages resolved from the profile
 * directory. The Trust Kernel is pinned as a shipped launch pins it, and
 * plugin manifest enforcement stays at its shipped default.
 *
 * Each staged plugin writes one marker when its module is evaluated and one
 * from its `apply`; the plugin every profile installs ends the run from the
 * launcher's readiness signal. A refused start exits nonzero on its own before
 * any staged module is evaluated.
 *
 * Red today on every case but the two controls: no launch reads the lock, and
 * no shipped bundle declares the unlocked-profile policy.
 * @module tests/first100/fixtures/P1-03.profile-lock-boot.composition
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE_BUNDLES } from '@deepseek-ai/dsh-app-boot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { buildCandidateLock, planLockCommit, type PluginLockFile, writeLockAtomically } from '@deepseek-ai/dsh-plugin-lock'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')

/** The custom profile every case launches. */
const PROFILE = 'b669'

/** The launch deadline, the same as the loader smoke's. */
const PROCESS_TIMEOUT_MS = 30_000

/** The version every staged plugin is installed at. */
const VERSION = '1.0.0'

/** The integrity the install records for a staged plugin. */
const INTEGRITY = `sha512-${'a'.repeat(86)}==`

/** A third-party bundle package staged in the profile's `node_modules`, and the markers its module writes. */
interface StagedPlugin {
  readonly name: string
  /** Written when the module is evaluated. */
  readonly evaluated: string
  /** Written from the plugin's `apply`. */
  readonly mounted: string
}

/** The plugin every profile installs; it ends the run once the launch is ready. */
const INSTALLED: StagedPlugin = { name: 'b669-installed-plugin', evaluated: 'B669-INSTALLED-EVALUATED', mounted: 'B669-INSTALLED-MOUNTED' }

/** A plugin put into the profile directory after the lock was written. */
const UNLISTED: StagedPlugin = { name: 'b669-unlisted-plugin', evaluated: 'B669-UNLISTED-EVALUATED', mounted: 'B669-UNLISTED-MOUNTED' }

/** A plain library installed into the profile directory: the lock records it, and it is not a bundle. */
const PLAIN_DEPENDENCY = 'b669-plain-library'

/**
 * The `package.json` a staged plugin is installed with.
 * @param plugin - the staged plugin.
 * @returns the manifest.
 */
function manifestOf(plugin: StagedPlugin): Record<string, unknown> {
  return { name: plugin.name, version: VERSION, type: 'module', main: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }
}

/**
 * The `package.json` a plain library is installed with: it declares no `dsh.bundle`.
 * @param name - the library's package name.
 * @returns the manifest.
 */
function plainManifestOf(name: string): Record<string, unknown> {
  return { name, version: VERSION, type: 'module', main: './index.mjs' }
}

/**
 * Stage one plugin under the profile's own `node_modules`, the directory
 * Node's resolution reaches for the bare specifier its patch row names.
 * @param profileDir - the profile directory.
 * @param plugin - the plugin.
 * @param endsRun - whether the plugin ends the run once the launch is ready.
 */
function stagePlugin(profileDir: string, plugin: StagedPlugin, endsRun: boolean): void {
  const dir = join(profileDir, 'node_modules', plugin.name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifestOf(plugin))}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${plugin.name}-row\n      name: ${plugin.name}\n`)
  writeFileSync(join(dir, 'index.mjs'), [
    `process.stdout.write(${JSON.stringify(plugin.evaluated)} + '\\n')`,
    `export const name = ${JSON.stringify(plugin.name)}`,
    'export function apply(ctx) {',
    `  process.stdout.write(${JSON.stringify(plugin.mounted)} + '\\n')`,
    ...endsRun ? ['  ctx.get(\'appReady\').onReady(() => { ctx.get(\'appExit\')(0) })'] : [],
    '}',
    '',
  ].join('\n'))
}

/**
 * Write the `pnpm-lock.yaml` an install leaves in the profile, recording one integrity for every package.
 * @param profileDir - the profile directory.
 * @param packages - the installed packages, plugins and plain libraries alike.
 * @param integrity - the integrity recorded for each.
 */
function writePnpmLock(profileDir: string, packages: readonly { readonly name: string }[], integrity: string): void {
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    ...packages.map(({ name }) => `      ${name}:\n        specifier: ${VERSION}\n        version: ${VERSION}`),
    '',
    'packages:',
    '',
    ...packages.map(({ name }) => `  ${name}@${VERSION}:\n    resolution: {integrity: ${integrity}}`),
    '',
    // pnpm's reader returns no packages at all when `snapshots:` is absent.
    'snapshots:',
    '',
    ...packages.map(({ name }) => `  ${name}@${VERSION}: {}`),
    '',
  ].join('\n'))
}

/**
 * Build the profile `dsh plugin add` leaves for the given plugins: a manifest
 * listing them as dependencies and composing them after the shipped bundles,
 * an empty user layer, the plugins themselves, and the install's
 * `pnpm-lock.yaml`. The first plugin ends the run. A plain library is a
 * dependency and is installed, but declares no bundle, so it is not composed.
 * @param profileDir - the profile directory.
 * @param plugins - the installed plugins.
 * @param plainDependencies - the installed plain libraries, by package name.
 */
function stageProfile(profileDir: string, plugins: readonly StagedPlugin[], plainDependencies: readonly string[] = []): void {
  mkdirSync(profileDir, { recursive: true })
  const installed = [...plugins.map(plugin => plugin.name), ...plainDependencies]
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dependencies: Object.fromEntries(installed.map(name => [name, VERSION] as const)),
    dsh: { profile: { bundles: [...DEFAULT_PROFILE_BUNDLES, ...plugins.map(plugin => plugin.name)], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  plugins.forEach((plugin, index) => { stagePlugin(profileDir, plugin, index === 0) })
  for (const name of plainDependencies) {
    const dir = join(profileDir, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(plainManifestOf(name))}\n`)
    writeFileSync(join(dir, 'index.mjs'), 'export {}\n')
  }
  writePnpmLock(profileDir, installed.map(name => ({ name })), INTEGRITY)
}

/**
 * Lock the given plugins as `dsh plugin` commits a lock: a candidate built
 * from the install as observed, validated against the empty lock a profile
 * starts with, and written atomically. `dsh plugin` observes every dependency
 * of the profile, so a plain library is locked beside the plugins.
 * @param profileDir - the profile directory.
 * @param plugins - the plugins to lock, observed as staged.
 * @param plainDependencies - the plain libraries to lock, by package name.
 */
async function lockProfile(profileDir: string, plugins: readonly StagedPlugin[], plainDependencies: readonly string[] = []): Promise<void> {
  const empty: PluginLockFile = { lockfileVersion: 1, entries: [], loadOrder: [] }
  const installed = [
    ...plugins.map(plugin => ({ name: plugin.name, manifest: manifestOf(plugin) })),
    ...plainDependencies.map(name => ({ name, manifest: plainManifestOf(name) })),
  ]
  const candidate = buildCandidateLock(installed.map(({ name, manifest }) => ({
    name,
    version: VERSION,
    manifest,
    dependencies: [],
    grantedCapabilities: [],
    integrity: INTEGRITY,
  })))
  if (candidate === undefined) throw new Error('b669 fixture: the observed install has a dependency cycle')
  const decision = planLockCommit(empty, candidate, empty)
  if (!decision.committed) throw new Error(`b669 fixture: the lock was not committed (${decision.reason}): ${decision.detail}`)
  await writeLockAtomically(join(profileDir, 'plugins.lock.json'), decision.lock)
}

/**
 * What the bundles a custom profile starts from declare for an unlocked
 * profile, each read from its `package.json` as the launch resolves it, from
 * the installation.
 * @returns every declared value, in `DEFAULT_PROFILE_BUNDLES` order; empty when none declares one.
 */
function shippedUnlockedPolicies(): unknown[] {
  const fromInstallation = createRequire(join(REPOSITORY_ROOT, 'apps/cli/package.json'))
  return DEFAULT_PROFILE_BUNDLES.flatMap((name) => {
    const manifest = JSON.parse(readFileSync(fromInstallation.resolve(`${name}/package.json`), 'utf8')) as {
      dsh?: { pluginLock?: { unlockedProfilePolicy?: unknown } }
    }
    const declared = manifest.dsh?.pluginLock?.unlockedProfilePolicy
    return declared === undefined ? [] : [declared]
  })
}

/** How one launch ended and what it wrote. */
interface Launch {
  readonly exitCode: number | undefined
  readonly stdout: string
  readonly stderr: string
}

/**
 * Stage a profile in a fresh working directory and launch `dsh --profile b669` against it once.
 * @param stage - writes the profile into the directory it is given.
 * @returns how the launch ended and what it wrote; no exit code when it was killed at the deadline.
 */
async function launch(stage: (profileDir: string) => Promise<void> | void): Promise<Launch> {
  const cwd = await mkdtemp(join(tmpdir(), 'p1-03-lock-boot-'))
  try {
    await stage(join(cwd, '.dsh', 'profiles', PROFILE))
    const command = resolveExampleLaunch({
      srcBin: BIN_SCRIPT,
      configArgs: ['--profile', PROFILE],
      tsconfigPath: TSCONFIG,
      env: {
        DSH_HOME: join(cwd, '.dsh'),
        DSH_AGENTS_HOME: join(cwd, '.agents'),
        DSH_TELEMETRY_DISABLED: '1',
        // Empty, not absent: the launch pins its Trust Kernel as a shipped launch does.
        DSH_TRUST_KERNEL_INSECURE: '',
      },
    })
    const result = await execa(command.command, command.args, {
      cwd,
      env: command.env,
      input: '',
      timeout: PROCESS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      reject: false,
      stripFinalNewline: false,
    })
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

/** How a launch ended, and which staged plugins' modules were evaluated and mounted. */
interface Outcome {
  readonly exit: 'zero' | 'nonzero' | 'killed'
  readonly evaluated: readonly string[]
  readonly mounted: readonly string[]
}

/** A refused start: a nonzero exit of its own, before any staged plugin's module was evaluated. */
const REFUSED: Outcome = { exit: 'nonzero', evaluated: [], mounted: [] }

/**
 * Read one launch's outcome.
 * @param run - the launch.
 * @param staged - the plugins the profile holds.
 * @returns the outcome.
 */
function outcomeOf(run: Launch, staged: readonly StagedPlugin[]): Outcome {
  return {
    exit: run.exitCode === undefined ? 'killed' : run.exitCode === 0 ? 'zero' : 'nonzero',
    evaluated: staged.filter(plugin => run.stdout.includes(plugin.evaluated)).map(plugin => plugin.name),
    mounted: staged.filter(plugin => run.stdout.includes(plugin.mounted)).map(plugin => plugin.name),
  }
}

/**
 * A start that evaluated and mounted the given plugins and then ended as they asked.
 * @param plugins - the plugins that ran.
 * @returns the outcome.
 */
function startedWith(plugins: readonly StagedPlugin[]): Outcome {
  const names = plugins.map(plugin => plugin.name)
  return { exit: 'zero', evaluated: names, mounted: names }
}

/**
 * The failure detail every assertion carries.
 * @param run - the launch.
 * @returns its exit code and the tails of both streams.
 */
function detail(run: Launch): string {
  return `exit ${String(run.exitCode)}\nstdout tail:\n${run.stdout.slice(-600)}\nstderr tail:\n${run.stderr.slice(-1500)}`
}

describe('P1-03 on a real `dsh --profile` launch: a plugin lock that does not match the profile directory stops the start (B-669)', () => {
  it('control: a profile whose lock records its installed plugin starts and runs it, and the shipped base bundle needs no lock entry', async () => {
    const run = await launch(async (profileDir) => {
      stageProfile(profileDir, [INSTALLED])
      await lockProfile(profileDir, [INSTALLED])
    })
    expect(outcomeOf(run, [INSTALLED]), detail(run)).toEqual(startedWith([INSTALLED]))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control: a profile whose lock also records a plain dependency it installed, which is not a bundle, starts and runs its plugin', async () => {
    // The lock `dsh plugin` writes covers every dependency of the profile, a
    // plain library included, so the start must weigh that library as
    // installed rather than refuse it as missing (B-669b).
    const run = await launch(async (profileDir) => {
      stageProfile(profileDir, [INSTALLED], [PLAIN_DEPENDENCY])
      await lockProfile(profileDir, [INSTALLED], [PLAIN_DEPENDENCY])
    })
    expect(outcomeOf(run, [INSTALLED]), detail(run)).toEqual(startedWith([INSTALLED]))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('must[2]: a plugin installed in the profile directory but absent from the lock is not loaded, and the start is refused', async () => {
    const run = await launch(async (profileDir) => {
      stageProfile(profileDir, [INSTALLED, UNLISTED])
      await lockProfile(profileDir, [INSTALLED])
    })
    expect(outcomeOf(run, [INSTALLED, UNLISTED]), detail(run)).toEqual(REFUSED)
    expect(run.stderr, detail(run)).toContain(UNLISTED.name)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('must[2]: a plugin whose manifest changed after the lock was written is not loaded, and the start is refused', async () => {
    const run = await launch(async (profileDir) => {
      stageProfile(profileDir, [INSTALLED])
      await lockProfile(profileDir, [INSTALLED])
      const changed = { ...manifestOf(INSTALLED), description: 'changed after the lock was written' }
      writeFileSync(join(profileDir, 'node_modules', INSTALLED.name, 'package.json'), `${JSON.stringify(changed)}\n`)
    })
    expect(outcomeOf(run, [INSTALLED]), detail(run)).toEqual(REFUSED)
    expect(run.stderr, detail(run)).toContain(INSTALLED.name)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[0]: a plugin whose install record carries an integrity other than the locked one is not loaded, and the start is refused', async () => {
    const run = await launch(async (profileDir) => {
      stageProfile(profileDir, [INSTALLED])
      await lockProfile(profileDir, [INSTALLED])
      // The install record changes after the lock was written, as a
      // reinstall of a replaced archive with the same manifest leaves it.
      writePnpmLock(profileDir, [INSTALLED], `sha512-${'b'.repeat(86)}==`)
    })
    expect(outcomeOf(run, [INSTALLED]), detail(run)).toEqual(REFUSED)
    expect(run.stderr, detail(run)).toContain(INSTALLED.name)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('must[2]: an unlocked profile with an installed plugin does what the shipped bundles declare under dsh.pluginLock.unlockedProfilePolicy', async () => {
    const run = await launch((profileDir) => { stageProfile(profileDir, [INSTALLED]) })
    const declared = shippedUnlockedPolicies()
    expect(declared, 'no bundle in DEFAULT_PROFILE_BUNDLES declares dsh.pluginLock.unlockedProfilePolicy').not.toEqual([])
    // The most restrictive declaration wins, so one `refuse` refuses.
    expect(outcomeOf(run, [INSTALLED]), detail(run)).toEqual(declared.includes('refuse') ? REFUSED : startedWith([INSTALLED]))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
