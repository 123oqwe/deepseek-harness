/**
 * Driver for A-457 under P4-11 acceptance[0]: boot the SHIPPED headless
 * profile with the `a457-failing` adapter, whose route carries the `always`
 * retry policy, run one turn whose first model attempt fails as `A457_FAILURE`
 * names, and report one `A457-RESULT` line: how many conversation attempts the
 * adapter saw, how many `llm/retry` events the sessions hold, and how the
 * turns ended. Written after A-418c's driver.
 * @module tests/first100/fixtures/loader/p4-11-always/driver
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('a457 driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'a457-always',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  let turnError: string | null = null
  try {
    await runFixtureTurn(ctx, { task: 'say ok' })
  } catch (error: unknown) {
    // A permanent failure that is not retried may end the turn with an error; it is reported, not rethrown.
    turnError = error instanceof Error ? error.message : String(error)
  }
  const events = ctx.agents.list().flatMap(agent => agent.session.snapshotEvents())
  process.stdout.write(`A457-RESULT ${JSON.stringify({
    failure: process.env.A457_FAILURE ?? null,
    attempts: (globalThis as { __a457Attempts?: number }).__a457Attempts ?? 0,
    retryEvents: events.filter(event => event.type === 'llm/retry').length,
    turnEnds: events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : []),
    turnError,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
