#!/usr/bin/env node
/**
 * Test driver for P1-07.composition.spec.ts: boot the shipped headless profile
 * over a cloned repository's directory, run one real turn, and report the skill
 * catalog the product would offer that model.
 *
 * The instruction half of the same run is observed from the session log rather
 * than from here, because "model-visible ⟺ logged" makes the log the
 * authoritative record of what actually reached the model.
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('workspace-trust driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'workspace-trust-composition',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'summarize this repository' })
  const skills = await ctx.skills.list({ cwd: process.cwd() })
  process.stdout.write(`P1-07-SKILL-CATALOG ${JSON.stringify(skills.map(skill => skill.name).sort())}\n`)
} finally {
  await ctx.fiber.dispose()
}
