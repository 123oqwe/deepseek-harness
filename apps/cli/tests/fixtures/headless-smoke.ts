/**
 * Boot the real `dsh --profile headless` bin against an isolated DSH_HOME.
 *
 * Shared by the P9-03 and P9-06 real-composition specs. They stage the same
 * profile and differ only in the arguments they pass, so a copy in each would
 * be two definitions of "the profile these cases run against" — and the first
 * time one changed, the other would keep asserting against a world that no
 * longer existed.
 *
 * @module apps/cli/tests/fixtures/headless-smoke
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/** Repository root, from this file's own location. */
export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')
const TWO_ROUTE_PLUGIN = join(REPOSITORY_ROOT, 'apps/cli/tests/fixtures/two-route-llm.ts')

/** @param profileDir - where to write the profile manifest. */
function writeProfileManifest(profileDir: string): void {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
}

/**
 * Materialize a headless profile whose only model routes are the fixture's.
 *
 * `llm-deepseek` is disabled so no real provider is reachable: a run that
 * somehow bypassed the route selection would fail rather than quietly answer,
 * which is what keeps a passing assertion meaningful.
 * @param cwd - the smoke's isolated temporary working directory.
 */
export function stageProfile(cwd: string): void {
  const profileDir = join(cwd, '.dsh', 'profiles', 'headless')
  writeProfileManifest(profileDir)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
    '- id: llm-deepseek',
    '  disabled: true',
    '',
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: './.sessions'",
    '',
    '- insert:',
    '    - id: p9-03-two-route-llm',
    `      name: '${TWO_ROUTE_PLUGIN}'`,
    '',
  ].join('\n'))
}

/**
 * Materialize the same profile with NO adapter at all.
 *
 * Not a hypothetical: `llm-deepseek` is the only shipped route in this bundle,
 * and a deployment that disables it without adding one lands here.
 * @param cwd - the smoke's isolated temporary working directory.
 */
export function stageRouteless(cwd: string): void {
  const profileDir = join(cwd, '.dsh', 'profiles', 'headless')
  writeProfileManifest(profileDir)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '- id: llm-deepseek\n  disabled: true\n')
}

/**
 * Run the real bin once with the given launcher arguments.
 * @param label - smoke label, distinct per case so temporary paths never collide.
 * @param binArgs - arguments after the bin, exactly as a user would type them.
 * @param expectedExitCode - the exit this case pins; the smoke fails on any other, including success.
 * @param prepare - which profile to stage.
 * @returns the captured streams.
 */
export async function runDsh(
  label: string,
  binArgs: readonly string[],
  expectedExitCode = 0,
  prepare: (cwd: string) => void = stageProfile,
): Promise<{ stdout: string; stderr: string }> {
  return runLoaderSmoke({
    label,
    tempDirPrefix: `dsh-${label}-`,
    binScript: BIN_SCRIPT,
    configPath: '',
    binArgs: [...binArgs],
    tsconfigPath: TSCONFIG,
    env: { DSH_TRUST_KERNEL_INSECURE: '1', DSH_TELEMETRY_DISABLED: '1' },
    prepare,
    expectedExitCode,
  })
}
