#!/usr/bin/env node
/**
 * Test driver for P4-11's mount slice: boot the SHIPPED headless profile, run
 * one real turn against an endpoint that fails once, and report what the
 * factory composition actually has mounted and what the retry cost the run.
 *
 * Reported from the live Context rather than asserted here, so the spec reads
 * one process's observation instead of trusting this file's own conclusion.
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('p4-11 driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'p4-11-retry-mount',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const usage = ctx.get('runRetryUsage')
  const breaker = ctx.get('circuitBreaker')
  process.stdout.write(`P4-11-MOUNTED ${JSON.stringify({ runRetryUsage: usage !== undefined, circuitBreaker: breaker !== undefined })}\n`)
  await runFixtureTurn(ctx, { task: 'say ok' })
  // What the retry cost the run the AGENT holds — `runFor` is the service's
  // own way in, and it is the run `llm-retry` charges through the delegation
  // root. A retry charged to nothing is the state the 4.4d pass found.
  const charged = ctx.agents.list().map((agent) => {
    const run = ctx.get('runs')?.runFor(agent)
    return { run: String(run?.id ?? 'none'), usage: run === undefined ? undefined : usage?.usageOf(run.id) }
  })
  process.stdout.write(`P4-11-CHARGED ${JSON.stringify(charged)}\n`)
  // What the session recorded about retries, so a zero charge can be told
  // apart from a retry that never happened.
  const retried = ctx.agents.list().flatMap(agent =>
    agent.session.snapshotEvents().map(event => event.type))
  process.stdout.write(`P4-11-EVENTS ${JSON.stringify(retried)}\n`)
} finally {
  await ctx.fiber.dispose()
}
