#!/usr/bin/env node
/**
 * Test driver for P1-07.composition.spec.ts: boot the shipped headless profile
 * over a cloned repository's directory, run one real turn, and report the skill
 * catalog the product would offer that model.
 *
 * The instruction half of the same run is observed from the session log rather
 * than from here, because "model-visible ⟺ logged" makes the log the
 * authoritative record of what actually reached the model.
 *
 * `P1_07_TRUST_VIA_COMMAND` selects the third mode: instead of a configured
 * grant, the host user runs `/trust-skills` and confirms. That mode is what
 * proves the two halves of the execute chain compose on ONE boot — the command
 * reaching the trust state, and the trust state reaching the catalog — which
 * neither half's own cases can show.
 */

import { join } from 'node:path'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

/**
 * The cloned repository lives below the smoke's cwd: the harness points
 * DSH_HOME at the cwd itself, so a clone written there would be discovered as
 * the HOST's own skill root rather than the project's.
 */
const CLONE_DIR = 'clone'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('workspace-trust driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'workspace-trust-composition',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  if (process.env.P1_07_TRUST_VIA_COMMAND !== undefined) {
    // A host user who says yes. The command asks through the real approval
    // seam; without an answerer the seam settles `'unavailable'` and the
    // command changes nothing, which is the non-interactive case the unit
    // suites already cover.
    ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
  }
  await runFixtureTurn(ctx, { task: 'summarize this repository' })
  if (process.env.P1_07_TRUST_VIA_COMMAND !== undefined) {
    const [agent] = ctx.get('agents')?.roots() ?? []
    if (agent === undefined) throw new Error('the composition driver found no configured agent')
    // No turn is opened here on purpose. The fixture's own turn has ENDED, so
    // this is the idle session a host user actually types a command into, and
    // the approval the command asks for is enclosed by the command's own
    // `command/run` … `command/done` pair (BLOCKED-205). A stopgap `turn/start`
    // here would have made the case pass while proving nothing about the path
    // a real user takes.
    const execution = await ctx.commands.execute(agent, '/trust-skills', [], new AbortController().signal)
    if (execution === undefined) throw new Error('/trust-skills did not resolve — the command row is not mounted')
    process.stdout.write(`P1-07-TRUST-COMMAND ${JSON.stringify(execution.result)}\n`)
  }
  const skills = await ctx.skills.list({ cwd: join(process.cwd(), CLONE_DIR) })
  process.stdout.write(`P1-07-SKILL-CATALOG ${JSON.stringify(skills.map(skill => skill.name).sort())}\n`)
} finally {
  await ctx.fiber.dispose()
}
