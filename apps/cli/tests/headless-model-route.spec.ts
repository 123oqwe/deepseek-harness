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
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

import { runDsh, stageRouteless } from './fixtures/headless-smoke.ts'

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
