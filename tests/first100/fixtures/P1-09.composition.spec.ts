/**
 * P1-09 U-stage composition contract: the ownership and namespace gate on the
 * REAL tool registry, reached through a real `@deepseek-ai/dsh-app-boot` boot
 * of a real Loader composition (`tests/first100/fixtures/loader/p1-09-ownership/`),
 * with two ordinary plugin modules mounted as ordinary Loader entries.
 *
 * The Contract stage proved `claimCapability`/`requestReplace`/
 * `revokeByOwnershipToken` against registries a test built by hand, and had no
 * caller anywhere in the repository. This fixture is the one that cannot pass
 * without the gate being wired into a plugin's real registration path:
 * validation[0]'s "运行 two-plugin collision fixture" is exactly this boot, and
 * the gate's "Collision rejected before activation" is the assertion that
 * `boot()` never completes when the second plugin claims a name the first
 * already owns.
 *
 * Every assertion is on the JSON report the driver writes, never on a
 * filesystem behavior or a temp path, so each property is evaluated
 * identically on every platform.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { afterEach, describe, expect, it } from 'vitest'

// A Loader-mounted plugin's PluginIdentity is its ENTRY MODULE SPECIFIER --
// the registrant's stable on-disk identity -- not the `name` the plugin
// object declares for diagnostics. For these fixture entries that specifier is
// the relative path in the cordis.yml; for a shipped plugin it is its package
// name.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const fixtureDir = fileURLToPath(new URL('./loader/p1-09-ownership/', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')

mkdirSync(join(fixtureDir, 'tmp'), { recursive: true })

/** What the driver writes after booting one composition. */
interface Report {
  readonly booted: boolean
  readonly message?: string
  readonly inspectError?: string
  readonly toolNames?: readonly string[]
  readonly owners?: Readonly<Record<string, string>>
  readonly chain?: readonly { capabilityId: string; current: string; replaces?: string }[]
  readonly afterDisposeToolNames?: readonly string[]
  readonly afterDisposeChainLength?: number
}

const reportRoots: string[] = []
const runDirs: string[] = []

afterEach(() => {
  for (const root of reportRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const dir of runDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Copy the fixture tree into a fresh per-run directory and return it.
 *
 * The Cordis Loader WRITES BACK to the config file it booted: an entry whose
 * `apply` throws is persisted with `disabled: true`. Two of these compositions
 * are designed to fail, so booting the checked-in file would edit the
 * repository and make every later run read a tree with the failing entry
 * already switched off — a green that means nothing. Each boot therefore gets
 * its own copy.
 *
 * The copy stays INSIDE the repository (under a git-ignored `tmp/`) rather
 * than in the platform temp directory, because the fixture plugins import real
 * workspace packages, which only resolve from within the workspace. The
 * directory is uniquely named and removed in teardown, so concurrently forked
 * workers never share one.
 */
function copyFixture(): string {
  const runDir = mkdtempSync(join(fixtureDir, 'tmp', 'run-'))
  runDirs.push(runDir)
  for (const file of readdirSync(fixtureDir)) {
    if (statSync(join(fixtureDir, file)).isDirectory()) continue
    copyFileSync(join(fixtureDir, file), join(runDir, file))
  }
  return runDir
}

/**
 * Boot one of the fixture compositions and return the report it wrote. The
 * report path is owned through this file's `afterEach` teardown, so
 * concurrently forked workers never share one.
 */
async function bootFixture(configName: string, label: string): Promise<Report> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-p1-09-ownership-'))
  reportRoots.push(root)
  const reportPath = join(root, 'report.json')
  const runDir = copyFixture()
  await runLoaderSmoke({
    label,
    tempDirPrefix: 'p1-09-ownership-',
    binScript: join(runDir, 'driver.ts'),
    libBinScript: join(runDir, 'driver.ts'),
    configPath: join(runDir, configName),
    tsconfigPath,
    env: { P1_09_REPORT: reportPath },
  })
  return JSON.parse(readFileSync(reportPath, 'utf8')) as Report
}

describe('P1-09 ownership gate composition (U-stage)', () => {
  it('control: a single plugin claiming one uncontested, unreserved name boots and owns it', async () => {
    const report = await bootFixture('clean.cordis.yml', 'p1-09 clean boot')
    expect(report.booted).toBe(true)
    expect(report.inspectError).toBeUndefined()
    expect(report.toolNames).toEqual(['collide_tool'])
    expect(report.owners?.collide_tool).toBe('./first-owner.ts')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('validation[0]/gate: the two-plugin collision is rejected before the second plugin activates', async () => {
    const report = await bootFixture('collision.cordis.yml', 'p1-09 collision boot')
    expect(report.booted).toBe(false)
    expect(report.message).toContain('capability-collision')
    expect(report.message).toContain('./second-owner.ts')
    // Not the pre-existing per-layer duplicate message: a case that accepted
    // that text would stay green with the entire ownership gate deleted.
    expect(report.message).not.toContain('is already registered')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('validation[2]: a third-party Loader entry cannot claim a tool in the reserved dsh.* namespace', async () => {
    const report = await bootFixture('reserved.cordis.yml', 'p1-09 reserved boot')
    expect(report.booted).toBe(false)
    expect(report.message).toContain('namespace-reserved')
    expect(report.message).toContain('./reserved-claimant.ts')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[1]: an authorized replacement is admitted and the Inventory shows the replaced/replacing chain', async () => {
    const report = await bootFixture('replace.cordis.yml', 'p1-09 replace boot')
    expect(report.booted).toBe(true)
    expect(report.inspectError).toBeUndefined()
    expect(report.owners?.collide_tool).toBe('./replacer.ts')
    expect(report.chain).toEqual([
      { capabilityId: 'collide_tool', current: './replacer.ts', replaces: './first-owner.ts' },
    ])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('gate: unloading one plugin entry leaves zero tools and zero ownership records for it in a still-live registry', async () => {
    const report = await bootFixture('clean.cordis.yml', 'p1-09 unload boot')
    expect(report.booted).toBe(true)
    expect(report.inspectError).toBeUndefined()
    expect(report.afterDisposeToolNames).toEqual([])
    expect(report.afterDisposeChainLength).toBe(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
