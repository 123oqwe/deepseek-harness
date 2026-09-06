/**
 * P9-03 Usage — `--model` on the real product path.
 *
 * The Provider stage drove `apply()` directly, which proves the runner calls
 * the resolver but not that a user can reach it: the flag has to survive the
 * launcher's own argument parsing, the profile's `cordis.patch.yml` `!!js`
 * expression, and schemastery's config validation before it means anything.
 * Any one of those dropping it produces a run that quietly uses the configured
 * default — the exact outcome must[0] forbids, and one no unit test sees.
 *
 * So this spawns the real `dsh --profile headless` bin against an isolated
 * DSH_HOME with two keyless routes registered, and reads the route out of the
 * ANSWER. must[2] asks for the selection to be auditable rather than hardcoded,
 * and the reply text is downstream of the request that was actually dispatched.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')
const TWO_ROUTE_PLUGIN = join(REPOSITORY_ROOT, 'apps/cli/tests/fixtures/two-route-llm.ts')

/**
 * Materialize a headless profile whose only model routes are the fixture's.
 *
 * `llm-deepseek` is disabled so no real provider is reachable: a run that
 * somehow bypassed `--model` would fail rather than quietly answer, which is
 * what keeps a passing assertion here meaningful.
 * @param cwd - the smoke's isolated temporary working directory.
 */
function stageProfile(cwd: string): void {
  const profileDir = join(cwd, '.dsh', 'profiles', 'headless')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
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
function stageRouteless(cwd: string): void {
  const profileDir = join(cwd, '.dsh', 'profiles', 'headless')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '- id: llm-deepseek\n  disabled: true\n')
}

/**
 * Run the real bin once with the given launcher arguments.
 * @param label - smoke label, distinct per case so temporary paths never collide.
 * @param binArgs - arguments after the bin, exactly as a user would type them.
 * @param expectedExitCode - the exit this case pins; the smoke fails on any other, including success.
 * @returns the captured streams.
 */
async function runDsh(
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

describe('P9-03 Usage — --model reaches a real dsh --profile headless run', () => {
  it('acceptance[0]: the same task on two --model values is answered by two different routes', async () => {
    const first = await runDsh('p9-03-route-a', ['--profile', 'headless', '--model', 'p9-mock-a:model-one', 'name your route'])
    expect(first.stdout).toContain('ROUTE=p9-mock-a MODEL=model-one')
    const second = await runDsh('p9-03-route-b', ['--profile', 'headless', '--model', 'p9-mock-b:model-two', 'name your route'])
    expect(second.stdout).toContain('ROUTE=p9-mock-b MODEL=model-two')
    // The tasks were identical, so the route is the only thing that differed.
    expect(first.stdout).not.toContain('p9-mock-b')
    expect(second.stdout).not.toContain('p9-mock-a')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[1]: an unregistered route exits non-zero, names the registered routes, and answers nothing', async () => {
    // The expected exit is the assertion: the smoke fails if this run
    // SUCCEEDS, which is what a build that ignored the bad route would do.
    const result = await runDsh('p9-03-unknown', ['--profile', 'headless', '--model', 'not-a-route:m', 'name your route'], 1)
    expect(result.stderr).toContain('unregistered route "not-a-route"')
    expect(result.stderr).toContain('p9-mock-a')
    expect(result.stderr).toContain('p9-mock-b')
    // Fail closed on the real path: no answer was produced on any other route.
    expect(result.stdout).not.toContain('ROUTE=')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

/**
 * P9-03 Fault — a profile that can serve no route at all.
 *
 * The refusal message is built from the routes that exist, so the case where
 * NONE exist is the one where a naive implementation prints `available routes:`
 * followed by nothing — a message that reads like a truncated bug rather than a
 * statement about the profile. This is also the one refusal a user cannot fix
 * by correcting their argument, so it has to say what is actually wrong.
 */
describe('P9-03 Fault — --model against a profile with no registered route', () => {
  it('says the profile has no routes rather than printing an empty list', async () => {
    const result = await runDsh(
      'p9-03-routeless',
      ['--profile', 'headless', '--model', 'anything:at-all', 'name your route'],
      1,
      stageRouteless,
    )
    expect(result.stderr).toContain('no provider routes are registered in this profile')
    expect(result.stderr).not.toContain('available routes:')
    expect(result.stdout).not.toContain('ROUTE=')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
