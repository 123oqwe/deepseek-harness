#!/usr/bin/env node
/**
 * Test driver for P1-07's U supplement (BLOCKED-214): boot the shipped **acp**
 * profile over a cloned repository and observe the first-time trust
 * authorization the ruling asks for.
 *
 * The profile matters and is the whole point. `workspace-trust-local` is
 * `disabled: true` in `dsh-base` and enabled by `acp-app` alone (plus
 * `web-app`), so nothing in this fixture turns the boundary on — if that bundle
 * row is set back to disabled, this driver boots without a provider and the
 * clone's own instructions load, which is what reddens the suite.
 *
 * `P1_07_ACP_ANSWER` scripts the host user's reply to the one question
 * `askForReadTrustOnce` puts. Unset means nobody answers, which is the
 * `'unavailable'` outcome a profile with no registered answerer produces.
 */

import { join } from 'node:path'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The cloned repository, below the smoke's cwd so it is not the HOST skill root. */
const CLONE_DIR = 'clone'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('acp trust driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'workspace-trust-acp',
  profile: 'acp',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const answer = process.env.P1_07_ACP_ANSWER
  if (answer !== undefined) {
    // Stands in for the ACP client, which is what answers `approval/request` on
    // this profile in production (`packages/acp/acp/src/index.ts`). The real
    // row is disabled above because it would bind a transport; what it
    // contributes to this question is exactly this listener.
    ctx.on('approval/request', () => Promise.resolve(answer as 'allowed-once'))
  }
  await runFixtureTurn(ctx, { task: 'summarize this repository' })
  const skills = await ctx.skills.list({ cwd: join(process.cwd(), CLONE_DIR) })
  process.stdout.write(`P1-07-SKILL-CATALOG ${JSON.stringify(skills.map(skill => skill.name).sort())}\n`)
} finally {
  await ctx.fiber.dispose()
}
