#!/usr/bin/env node
/**
 * Driver for BLOCKED-281 (b): boot the SHIPPED headless profile with the
 * `a418-failing` adapter, run one turn whose first model attempt fails as
 * `A418_FAILURE` names, and report one `A418-RESULT` line: what is mounted,
 * how many attempts the adapter saw, what each agent's Run was charged, and
 * how many `llm/retry` and `llm/retry-started` events the sessions hold.
 *
 * Mirrors the P4-11 mount slice's driver
 * (`packages/reliability/retry-cockatiel/tests/fixtures/driver.ts`), so the
 * mount is the one U.1 observes.
 * @module tests/first100/fixtures/loader/p4-11-permanent/driver
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('a418 driver requires a config path')

/** The session events `llm-retry` appends when it retries (`packages/llm/llm-retry/src/index.ts:191`, `:193`). */
const RETRY_EVENTS: ReadonlySet<string> = new Set(['llm/retry', 'llm/retry-started'])

const ctx = await bootProductionProfile({
  binName: 'a418-permanent',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const usage = ctx.get('runRetryUsage')
  let turnError: string | null = null
  try {
    await runFixtureTurn(ctx, { task: 'say ok' })
  } catch (error: unknown) {
    // A permanent failure may end the turn with an error; it is reported, not rethrown, so the counts below are still read.
    turnError = error instanceof Error ? error.message : String(error)
  }
  const charged = ctx.agents.list().map((agent) => {
    const run = ctx.get('runs')?.runFor(agent)
    return { run: String(run?.id ?? 'none'), retriesUsed: run === undefined ? null : usage?.usageOf(run.id).retriesUsed ?? null }
  })
  const retryEvents = ctx.agents.list().flatMap(agent => agent.session.snapshotEvents())
    .filter(event => RETRY_EVENTS.has(event.type)).length
  const attempts = (globalThis as { __a418Attempts?: number }).__a418Attempts ?? 0
  // A-418b: every model call the adapter saw, with its purpose and first stack frames.
  const calls = (globalThis as { __a418Calls?: unknown[] }).__a418Calls ?? []
  process.stdout.write(`A418-RESULT ${JSON.stringify({
    failure: process.env.A418_FAILURE ?? null,
    mounted: { runRetryUsage: usage !== undefined },
    attempts,
    charged,
    retryEvents,
    turnError,
    calls,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
