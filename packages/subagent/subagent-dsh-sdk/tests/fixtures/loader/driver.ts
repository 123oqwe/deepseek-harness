#!/usr/bin/env node
/** Test driver: one delegation turn through a headless Loader composition. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { declareDevelopmentProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/development-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('sdk-subagent cwd driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'sdk-subagent-cwd-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  // This driver dispatches the subagent tool on the shipped headless composition
  // without a pinned Trust Kernel; declare the development profile so the
  // dispatch runs unenforced as before rather than being refused (Epic P0-02
  // acceptance[2]).
  prepare: declareDevelopmentProfile,
})
try {
  await runFixtureTurn(ctx, { task: 'delegate' })
} finally {
  await ctx.fiber.dispose()
}
