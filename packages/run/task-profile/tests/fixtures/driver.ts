#!/usr/bin/env node
/**
 * Test driver for P4-02's mount slice: boot the SHIPPED headless profile, run
 * one real turn whose first message is a plain human goal, and report what the
 * session log, the Run log and the Agent handle hold.
 *
 * Reported from the live Context rather than asserted here, so the spec reads
 * one process's observation instead of trusting this file's own conclusion.
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { taskProfileRef } from '@deepseek-ai/dsh-task-profile/validate'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('p4-02 base-mount driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'p4-02-base-mount',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  // Whether the SHIPPED layers mounted the Run Service at all, reported before
  // the turn: a missing service and a service that compiled nothing are
  // different failures and the spec must be able to tell them apart.
  process.stdout.write(`P4-02-MOUNTED ${JSON.stringify({ runs: ctx.get('runs') !== undefined })}\n`)
  await runFixtureTurn(ctx, { task: 'rename the widget to gadget across the repo' })
  const observed = ctx.agents.list().map((agent) => {
    const events = agent.session.snapshotEvents().filter(event => event.type === 'run/task-profile')
    const run = ctx.get('runs')?.runFor(agent)
    return {
      profileEventCount: events.length,
      // Derived from each logged body, never read out of the event (BLOCKED-211).
      derivedRefs: events.map(event => taskProfileRef(event.data.profile)),
      handleTaskProfile: agent.taskProfile ?? null,
      runTaskProfileRefs: (run?.events ?? [])
        .flatMap(event => event.references)
        .filter(reference => reference.kind === 'task-profile')
        .map(reference => reference.id),
      runStates: (run?.events ?? []).map(event => `${String(event.fromState)}->${event.toState}`),
    }
  })
  process.stdout.write(`P4-02-OBSERVED ${JSON.stringify(observed)}\n`)
} finally {
  await ctx.fiber.dispose()
}
