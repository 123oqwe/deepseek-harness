#!/usr/bin/env node
/**
 * Test driver for P4-01.composition.spec.ts's restart cases: the same boot as
 * `../p4-01-run/driver.ts`, over a composition whose configured agent declares
 * a stable `sessionId`. Two runs of this driver over one `P4_01_RUN_STORE` are
 * a restart of one durable session, which is the arrangement in which there is
 * a Run to continue.
 *
 * It also prints what the plugin enumerated at mount, because that is the half
 * of acceptance[0] the durable document cannot show: the store says which Runs
 * are non-terminal, not that this process asked.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('p4-01-run driver requires a config path')

const ctx = await boot('p4-01-run-resumed-loader-smoke', resolveConfigPath(configPath, undefined))
console.log(`p4-01-run-resumed: restored ${ctx.runs.restoredNonTerminal().length} non-terminal Run(s)`)
for (const agent of ctx.agents.roots()) await agent.whenIdle()
await ctx.fiber.dispose()
