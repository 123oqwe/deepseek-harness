#!/usr/bin/env node
/**
 * Test driver for P0-01.composition.spec.ts: boot a minimal composition
 * mounting only `@deepseek-ai/dsh-baseline-preflight` through the real
 * `@deepseek-ai/dsh-app-boot` path. A clean fixture proves the plugin lets a
 * normal boot through; a drifted fixture proves `apply` genuinely aborts
 * startup (not a no-op registration) — `boot()` rejecting propagates as an
 * uncaught top-level rejection, so Node exits nonzero with the thrown error's
 * stack, including the drifted path(s), on stderr.
 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('baseline-preflight driver requires a config path')

const ctx = await boot('baseline-preflight-loader-smoke', resolveConfigPath(configPath, undefined))
await ctx.fiber.dispose()
