#!/usr/bin/env node
/**
 * Test driver for §12.79's first invariant: boot the shipped headless profile
 * and drive one turn WITHOUT seeding any memory record, so the recall returns
 * nothing.
 *
 * It seeds nothing and asserts nothing. The whole observation is the
 * `request.json` the mock adapter writes and the session log the run leaves,
 * both read by the spec, which runs this same driver twice — once over a
 * config with the memory rows enabled and once over a config without them —
 * and compares what the model was handed.
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('empty-recall driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'memory-context-empty-smoke',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'deploy passphrase' })
} finally {
  await ctx.fiber.dispose()
}
