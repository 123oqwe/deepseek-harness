#!/usr/bin/env node
/**
 * Test driver for P4-01.composition.spec.ts: boot a minimal composition that
 * mounts `@deepseek-ai/dsh-run` alongside a real agent registry and agent
 * loop through the real `@deepseek-ai/dsh-app-boot` path, let the configured
 * root agent reach idle, then dispose. The Run the harness opened for that
 * agent's session is left behind in the durable store at `P4_01_RUN_STORE`,
 * which the spec inspects after the process exits.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('p4-01-run driver requires a config path')

const ctx = await boot('p4-01-run-loader-smoke', resolveConfigPath(configPath, undefined))
for (const agent of ctx.agents.roots()) await agent.whenIdle()
await ctx.fiber.dispose()
