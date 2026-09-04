/**
 * Epic P1-08.U's acceptance[1] proved on the real product path: a bundle
 * whose declared `dsh.compat` cannot be satisfied has its plugin code never
 * executed at a real `dsh --profile` launch.
 *
 * This is a real-composition test, not a hand-built `ctx.plugin(...)` suite:
 * `runLoaderSmoke` spawns the actual `dsh` bin against an isolated
 * `DSH_HOME` holding a real profile whose two real on-disk bundle packages
 * are mounted by the real Cordis Loader. The property asserted is the
 * clause's own — the blocked bundle's plugin produced no output while the
 * healthy one did — not that any particular internal function was called.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')

/** Marker each fixture plugin writes to stdout from inside its own `apply`, so mounting is observable from outside the process. */
const HEALTHY_MARKER = 'P1-08-HEALTHY-PLUGIN-MOUNTED'
const BLOCKED_MARKER = 'P1-08-BLOCKED-PLUGIN-MOUNTED'

/**
 * Stage one real bundle package that is also its own Loader plugin, under a
 * profile's own `node_modules` — the second anchor `resolveBundleDir`
 * searches, and the directory Node's own resolution reaches for the bare
 * specifier the bundle's patch row names.
 * @param profileDir - the profile directory the package is staged under.
 * @param name - the package name, used as both bundle name and plugin specifier.
 * @param compat - the package's `dsh.compat` declaration.
 * @param marker - the line this package's plugin writes when it mounts.
 * @param exitAfterMount - whether this plugin ends the process once mounted.
 */
function stageBundlePlugin(
  profileDir: string,
  name: string,
  compat: unknown,
  marker: string,
  exitAfterMount: boolean,
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
    ...exitAfterMount ? ['  setTimeout(() => { ctx.get(\'appExit\')(0) }, 0).unref?.()'] : [],
    '}',
    '',
  ].join('\n'))
}

/** A `dsh.compat` declaration with permissive defaults, overriding only what a case constrains. */
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
 * Materialize the two-bundle `compat` profile inside the smoke's own isolated
 * cwd. `runLoaderSmoke` points `DSH_HOME` at `<cwd>/.dsh` and owns that
 * directory's removal, so this writes no path the test has to clean up
 * itself, and no path shared with a concurrently running spec.
 * @param cwd - the smoke's isolated temporary working directory.
 */
function stageCompatProfile(cwd: string): void {
  const profileDir = join(cwd, '.dsh', 'profiles', 'compat')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-compat',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['compat-blocked-bundle', 'compat-healthy-bundle'], patchReload: 'startup' } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  // Declares a required, security-critical capability no bundle in this
  // profile provides: unsatisfiable, so acceptance[1] forbids running it.
  stageBundlePlugin(profileDir, 'compat-blocked-bundle', compatDeclaration({
    capabilities: [{ capabilityId: 'p1-08-absent-capability', necessity: 'required', securityCritical: true }],
  }), BLOCKED_MARKER, false)
  // Declares nothing it cannot get, so it mounts and ends the run.
  stageBundlePlugin(profileDir, 'compat-healthy-bundle', compatDeclaration(), HEALTHY_MARKER, true)
}

describe('acceptance[1]: an unsatisfiable bundle\'s plugin code never runs at a real profile boot', () => {
  it('mounts the healthy bundle and never the blocked one, and says why on stderr', async () => {
    const result = await runLoaderSmoke({
      label: 'p1-08-compat-profile',
      tempDirPrefix: 'dsh-p1-08-compat-boot-',
      binScript: BIN_SCRIPT,
      configPath: '',
      binArgs: ['--profile', 'compat'],
      tsconfigPath: TSCONFIG,
      env: { DSH_TRUST_KERNEL_INSECURE: '1' },
      prepare: stageCompatProfile,
    })
    expect(result.stdout).toContain(HEALTHY_MARKER)
    // The clause itself: not "the solver returned blocked", but that the
    // blocked bundle's own plugin code never executed in the real process.
    expect(result.stdout).not.toContain(BLOCKED_MARKER)
    expect(result.stderr).toContain('compat-blocked-bundle')
    expect(result.stderr).toContain('p1-08-absent-capability')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
