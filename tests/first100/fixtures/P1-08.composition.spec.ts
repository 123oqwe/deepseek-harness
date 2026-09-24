/**
 * Epic P1-08 on a real `dsh --profile` launch: a bundle whose declared
 * `dsh.compat` cannot be met is never evaluated and its exclusion is shown,
 * and a bundle missing only an optional capability runs with that capability
 * shown as disabled. No shipped bundle declares `dsh.compat`, so the profile
 * stages seven third-party bundle packages that do.
 *
 * `runLoaderSmoke` spawns the real `dsh` bin once against an isolated
 * `DSH_HOME`, with no trust-kernel opt-out, so the launch composes and boots
 * the way a production launch does. The profile itself is built by this file:
 * `compat` is not a shipped profile template. Each bundle's plugin module
 * writes one marker to stdout when it is evaluated and another from its own
 * `apply`, so "never runs" covers the module's top-level code as well as
 * `apply`. The launcher's own stderr lines are compared whole, because the
 * exclusion line and the disabled-capability line name the same package and
 * capability ids. The healthy plugin ends the process from the launcher's
 * readiness signal, which fires only after every entry has mounted.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')

/** A schema id the host registers at major 1 when its schema registry loads. */
const REGISTERED_SCHEMA_ID = 'sdk-protocol:InitializeParams'

/**
 * The seven staged bundles: each package name, the marker its module writes
 * when it is evaluated, and the marker its plugin writes from `apply`.
 */
const BUNDLES = {
  blockedCapability: { name: 'p1-08-blocked-capability', evaluated: 'P1-08-BLOCKED-CAPABILITY-EVALUATED', mounted: 'P1-08-BLOCKED-CAPABILITY-MOUNTED' },
  blockedSecurity: { name: 'p1-08-blocked-security', evaluated: 'P1-08-BLOCKED-SECURITY-EVALUATED', mounted: 'P1-08-BLOCKED-SECURITY-MOUNTED' },
  blockedSchemaAbove: { name: 'p1-08-blocked-schema-above', evaluated: 'P1-08-BLOCKED-SCHEMA-ABOVE-EVALUATED', mounted: 'P1-08-BLOCKED-SCHEMA-ABOVE-MOUNTED' },
  blockedSchemaBelow: { name: 'p1-08-blocked-schema-below', evaluated: 'P1-08-BLOCKED-SCHEMA-BELOW-EVALUATED', mounted: 'P1-08-BLOCKED-SCHEMA-BELOW-MOUNTED' },
  schemaControl: { name: 'p1-08-schema-control', evaluated: 'P1-08-SCHEMA-CONTROL-EVALUATED', mounted: 'P1-08-SCHEMA-CONTROL-MOUNTED' },
  optionalMissing: { name: 'p1-08-optional-missing', evaluated: 'P1-08-OPTIONAL-MISSING-EVALUATED', mounted: 'P1-08-OPTIONAL-MISSING-MOUNTED' },
  healthy: { name: 'p1-08-healthy', evaluated: 'P1-08-HEALTHY-EVALUATED', mounted: 'P1-08-HEALTHY-MOUNTED' },
} as const

type StagedBundle = (typeof BUNDLES)[keyof typeof BUNDLES]

/**
 * Stage one real bundle package that is also its own Loader plugin, under a
 * profile's own `node_modules`, the directory Node's resolution reaches for
 * the bare specifier the bundle's patch row names.
 * @param profileDir - the profile directory the package is staged under.
 * @param bundle - the package name and the two markers its module writes.
 * @param compat - the package's `dsh.compat` declaration.
 * @param exitOnReady - whether this plugin ends the process once the launcher reports readiness.
 */
function stageBundlePlugin(profileDir: string, bundle: StagedBundle, compat: unknown, exitOnReady: boolean): void {
  const pkgDir = join(profileDir, 'node_modules', bundle.name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: bundle.name,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' }, compat },
  }) + '\n')
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${bundle.name}-row\n      name: ${bundle.name}\n`)
  writeFileSync(join(pkgDir, 'index.mjs'), [
    `process.stdout.write(${JSON.stringify(bundle.evaluated)} + '\\n')`,
    `export const name = ${JSON.stringify(bundle.name)}`,
    'export function apply(ctx) {',
    `  process.stdout.write(${JSON.stringify(bundle.mounted)} + '\\n')`,
    ...exitOnReady ? ['  ctx.get(\'appReady\').onReady(() => { ctx.get(\'appExit\')(0) })'] : [],
    '}',
    '',
  ].join('\n'))
}

/**
 * A `dsh.compat` declaration with permissive defaults, overriding only what a bundle constrains.
 * @param overrides - the fields this bundle declares.
 * @returns the complete declaration.
 */
function compatDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runtimeApiRange: { min: 1, max: 5 },
    schemaRanges: [],
    capabilities: [],
    providerConstraints: [],
    providedCapabilities: [],
    ...overrides,
  }
}

/**
 * A schema range over {@link REGISTERED_SCHEMA_ID} spanning one major.
 * @param major - the only major the range accepts.
 * @returns the declared range.
 */
function schemaRangeAt(major: number): Record<string, unknown>[] {
  return [{ schemaId: REGISTERED_SCHEMA_ID, minVersion: { major, minor: 0 }, maxVersion: { major, minor: 9 } }]
}

/**
 * Materialize the seven-bundle `compat` profile inside the smoke's isolated
 * cwd. `runLoaderSmoke` points `DSH_HOME` at `<cwd>/.dsh` and owns that
 * directory's removal.
 * @param cwd - the smoke's isolated temporary working directory.
 */
function stageCompatProfile(cwd: string): void {
  const profileDir = join(cwd, '.dsh', 'profiles', 'compat')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-compat',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: Object.values(BUNDLES).map(bundle => bundle.name),
        patchReload: 'startup',
      },
    },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  stageBundlePlugin(profileDir, BUNDLES.blockedCapability, compatDeclaration({
    capabilities: [{ capabilityId: 'p1-08-absent-capability', necessity: 'required', securityCritical: false }],
  }), false)
  stageBundlePlugin(profileDir, BUNDLES.blockedSecurity, compatDeclaration({
    capabilities: [{ capabilityId: 'p1-08-absent-security-capability', necessity: 'required', securityCritical: true }],
  }), false)
  stageBundlePlugin(profileDir, BUNDLES.blockedSchemaAbove, compatDeclaration({ schemaRanges: schemaRangeAt(2) }), false)
  stageBundlePlugin(profileDir, BUNDLES.blockedSchemaBelow, compatDeclaration({ schemaRanges: schemaRangeAt(0) }), false)
  stageBundlePlugin(profileDir, BUNDLES.schemaControl, compatDeclaration({ schemaRanges: schemaRangeAt(1) }), false)
  stageBundlePlugin(profileDir, BUNDLES.optionalMissing, compatDeclaration({
    capabilities: [{ capabilityId: 'p1-08-absent-optional', necessity: 'optional', securityCritical: false }],
  }), false)
  stageBundlePlugin(profileDir, BUNDLES.healthy, compatDeclaration(), true)
}

describe('P1-08 composition: seven declared bundles through one real `dsh --profile compat` launch', () => {
  let stdout = ''
  let stderrLines: string[] = []

  beforeAll(async () => {
    const result = await runLoaderSmoke({
      label: 'p1-08-compat-composition',
      tempDirPrefix: 'dsh-p1-08-compat-composition-',
      binScript: BIN_SCRIPT,
      configPath: '',
      binArgs: ['--profile', 'compat'],
      tsconfigPath: TSCONFIG,
      prepare: stageCompatProfile,
    })
    stdout = result.stdout
    stderrLines = result.stderr.split('\n')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  /**
   * Assert a staged bundle's module was never evaluated, so neither its
   * top-level code nor its `apply` ran.
   * @param bundle - the staged bundle.
   */
  const expectNeverEvaluated = (bundle: StagedBundle): void => {
    expect(stdout).not.toContain(bundle.evaluated)
    expect(stdout).not.toContain(bundle.mounted)
  }

  /**
   * Assert a staged bundle's module was evaluated and its plugin mounted.
   * @param bundle - the staged bundle.
   */
  const expectEvaluatedAndMounted = (bundle: StagedBundle): void => {
    expect(stdout).toContain(bundle.evaluated)
    expect(stdout).toContain(bundle.mounted)
  }

  it('acceptance[1]: a bundle missing a required capability that is not security-critical is never evaluated, and its exclusion is shown whole', () => {
    expectNeverEvaluated(BUNDLES.blockedCapability)
    expect(stderrLines).toContain(
      'dsh: plugin compatibility: excluding bundle "p1-08-blocked-capability" from profile "compat" (missing-required-capability: p1-08-absent-capability)',
    )
  })

  it('acceptance[1]: a bundle missing a required security-critical capability is never evaluated, and its exclusion is shown whole', () => {
    expectNeverEvaluated(BUNDLES.blockedSecurity)
    expect(stderrLines).toContain(
      'dsh: plugin compatibility: excluding bundle "p1-08-blocked-security" from profile "compat" (missing-required-capability: p1-08-absent-security-capability)',
    )
  })

  it('acceptance[1]: a bundle declaring a schema major above the one the host registers is never evaluated, and its exclusion is shown whole', () => {
    expectNeverEvaluated(BUNDLES.blockedSchemaAbove)
    expect(stderrLines).toContain(
      'dsh: plugin compatibility: excluding bundle "p1-08-blocked-schema-above" from profile "compat" (schema-major-mismatch)',
    )
  })

  it('acceptance[1]: a bundle declaring a schema major below the one the host registers is never evaluated, and its exclusion is shown whole', () => {
    expectNeverEvaluated(BUNDLES.blockedSchemaBelow)
    expect(stderrLines).toContain(
      'dsh: plugin compatibility: excluding bundle "p1-08-blocked-schema-below" from profile "compat" (schema-major-mismatch)',
    )
  })

  it('control: the same schema id at the registered major is evaluated and runs, so the refusals above are the major and not an unknown id', () => {
    expectEvaluatedAndMounted(BUNDLES.schemaControl)
    expect(stderrLines.filter(line => line.includes('excluding bundle') && line.includes(BUNDLES.schemaControl.name))).toEqual([])
  })

  it('acceptance[2]: a bundle missing an optional capability is evaluated and runs, and the disabled capability is shown whole on the launch output', () => {
    expectEvaluatedAndMounted(BUNDLES.optionalMissing)
    expect(stderrLines).toContain(
      'dsh: plugin compatibility: bundle "p1-08-optional-missing" is active with disabled optional capabilities: p1-08-absent-optional',
    )
  })

  it('control: a bundle declaring nothing it cannot get is evaluated and runs', () => {
    expectEvaluatedAndMounted(BUNDLES.healthy)
  })
})
