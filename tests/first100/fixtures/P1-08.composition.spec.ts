/**
 * Epic P1-08 on a real `dsh --profile` launch: a bundle whose declared
 * `dsh.compat` cannot be met never runs and its exclusion is shown, and a
 * bundle missing only an optional capability runs with that capability shown
 * as disabled. No shipped bundle declares `dsh.compat`, so the profile stages
 * five third-party bundle packages that do.
 *
 * `runLoaderSmoke` spawns the real `dsh` bin once against an isolated
 * `DSH_HOME`; each bundle's plugin writes a marker to stdout from its own
 * `apply`, and the launcher's own stderr lines are compared whole, because
 * the exclusion line and the disabled-capability line name the same package
 * and capability ids. The healthy plugin ends the process from the launcher's
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

/** The five staged bundles, each named by the package it is and the marker its plugin prints. */
const BUNDLES = {
  blockedCapability: { name: 'p1-08-blocked-capability', marker: 'P1-08-BLOCKED-CAPABILITY-MOUNTED' },
  blockedSchema: { name: 'p1-08-blocked-schema', marker: 'P1-08-BLOCKED-SCHEMA-MOUNTED' },
  schemaControl: { name: 'p1-08-schema-control', marker: 'P1-08-SCHEMA-CONTROL-MOUNTED' },
  optionalMissing: { name: 'p1-08-optional-missing', marker: 'P1-08-OPTIONAL-MISSING-MOUNTED' },
  healthy: { name: 'p1-08-healthy', marker: 'P1-08-HEALTHY-MOUNTED' },
} as const

/**
 * Stage one real bundle package that is also its own Loader plugin, under a
 * profile's own `node_modules`, the directory Node's resolution reaches for
 * the bare specifier the bundle's patch row names.
 * @param profileDir - the profile directory the package is staged under.
 * @param name - the package name, used as both bundle name and plugin specifier.
 * @param compat - the package's `dsh.compat` declaration.
 * @param marker - the line this package's plugin writes when it mounts.
 * @param exitOnReady - whether this plugin ends the process once the launcher reports readiness.
 */
function stageBundlePlugin(
  profileDir: string,
  name: string,
  compat: unknown,
  marker: string,
  exitOnReady: boolean,
): void {
  const pkgDir = join(profileDir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' }, compat },
  }) + '\n')
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), `- insert:\n    - id: ${name}-row\n      name: ${name}\n`)
  writeFileSync(join(pkgDir, 'index.mjs'), [
    `export const name = ${JSON.stringify(name)}`,
    'export function apply(ctx) {',
    `  process.stdout.write(${JSON.stringify(marker)} + '\\n')`,
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
 * Materialize the five-bundle `compat` profile inside the smoke's isolated
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
  stageBundlePlugin(profileDir, BUNDLES.blockedCapability.name, compatDeclaration({
    capabilities: [{ capabilityId: 'p1-08-absent-capability', necessity: 'required', securityCritical: true }],
  }), BUNDLES.blockedCapability.marker, false)
  stageBundlePlugin(profileDir, BUNDLES.blockedSchema.name, compatDeclaration({
    schemaRanges: [{ schemaId: REGISTERED_SCHEMA_ID, minVersion: { major: 2, minor: 0 }, maxVersion: { major: 2, minor: 9 } }],
  }), BUNDLES.blockedSchema.marker, false)
  stageBundlePlugin(profileDir, BUNDLES.schemaControl.name, compatDeclaration({
    schemaRanges: [{ schemaId: REGISTERED_SCHEMA_ID, minVersion: { major: 1, minor: 0 }, maxVersion: { major: 1, minor: 9 } }],
  }), BUNDLES.schemaControl.marker, false)
  stageBundlePlugin(profileDir, BUNDLES.optionalMissing.name, compatDeclaration({
    capabilities: [{ capabilityId: 'p1-08-absent-optional', necessity: 'optional', securityCritical: false }],
  }), BUNDLES.optionalMissing.marker, false)
  stageBundlePlugin(profileDir, BUNDLES.healthy.name, compatDeclaration(), BUNDLES.healthy.marker, true)
}

describe('P1-08 composition: five declared bundles through one real `dsh --profile compat` launch', () => {
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
      env: { DSH_TRUST_KERNEL_INSECURE: '1' },
      prepare: stageCompatProfile,
    })
    stdout = result.stdout
    stderrLines = result.stderr.split('\n')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[1]: a bundle missing a required capability never runs, and its exclusion is shown whole', () => {
    expect(stdout).not.toContain(BUNDLES.blockedCapability.marker)
    expect(stderrLines).toContain(
      'dsh: plugin compatibility: excluding bundle "p1-08-blocked-capability" from profile "compat" (missing-required-capability: p1-08-absent-capability)',
    )
  })

  it('acceptance[1]: a bundle declaring a schema major the host does not register never runs, and its exclusion is shown whole', () => {
    expect(stdout).not.toContain(BUNDLES.blockedSchema.marker)
    expect(stderrLines).toContain(
      'dsh: plugin compatibility: excluding bundle "p1-08-blocked-schema" from profile "compat" (schema-major-mismatch)',
    )
  })

  it('control: the same schema id at the registered major runs, so the refusal above is the major and not an unknown id', () => {
    expect(stdout).toContain(BUNDLES.schemaControl.marker)
    expect(stderrLines.filter(line => line.includes('excluding bundle') && line.includes(BUNDLES.schemaControl.name))).toEqual([])
  })

  it('acceptance[2]: a bundle missing an optional capability runs, and the disabled capability is shown whole on the launch output', () => {
    expect(stdout).toContain(BUNDLES.optionalMissing.marker)
    expect(stderrLines).toContain(
      'dsh: plugin compatibility: bundle "p1-08-optional-missing" is active with disabled optional capabilities: p1-08-absent-optional',
    )
  })

  it('control: a bundle declaring nothing it cannot get runs', () => {
    expect(stdout).toContain(BUNDLES.healthy.marker)
  })
})
