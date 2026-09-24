#!/usr/bin/env node
/**
 * Test driver for P4-01 acceptance[2] on the SHIPPED headless profile (K1, K2):
 * the configured root agent starts one child through the shipped subagent
 * service's in-process `spawn` provider, and the driver reports what the Run
 * Service holds.
 *
 * `P4_01_SPAN_MODE=first` (the default) starts the child. `second` is the boot
 * after a restart over the same `DSH_HOME`: it starts nothing, and reports the
 * Runs the Run Service restored at mount and the Run the root agent continued.
 * Either way the store is read back from disk after the clean unload, so the
 * report is what the product wrote, not what a live object holds.
 */

import { readFileSync } from 'node:fs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('p4-01 span driver requires a config path')
const mode = process.env.P4_01_SPAN_MODE ?? 'first'

const ctx = await bootProductionProfile({
  binName: 'p4-01-span',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const registry = ctx.get('agents')
  const runs = ctx.get('runs')
  const subagents = ctx.get('subagents')
  // Whether the SHIPPED layers mounted the three services, reported before
  // anything runs: a missing service and a service that recorded nothing are
  // different failures.
  process.stdout.write(`P4-01-MOUNTED ${JSON.stringify({ runs: runs !== undefined, subagents: subagents !== undefined })}\n`)
  if (registry === undefined || runs === undefined || subagents === undefined) throw new Error('a shipped service is missing')
  // Configured agents publish asynchronously, so wait for the root.
  if (registry.roots().length === 0) {
    await new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/created', () => {
        dispose()
        resolve()
      })
    })
  }
  const roots = registry.roots()
  const parent: Agent | undefined = roots[0]
  if (parent === undefined || roots.length !== 1) throw new Error(`expected one root agent, found ${roots.length}`)

  if (mode === 'second') {
    const restored = runs.restoredNonTerminal().map(run => ({ id: run.id, sessionIds: run.sessionIds }))
    process.stdout.write(`P4-01-RESTORED ${JSON.stringify(restored)}\n`)
  } else {
    // Recorded as each session starts, from the registry's own ownership record.
    const owned: string[] = []
    ctx.on('agent/session-start', ({ agent }) => {
      if (registry.isOwnedBy(agent.id, parent)) owned.push(agent.id)
    })
    const child = await subagents.start('spawn', {
      prompt: [{ type: 'text', text: 'P4-01 child: reply with ok.' }],
      parent,
      signal: new AbortController().signal,
    })
    await child.result
    process.stdout.write(`P4-01-OWNED ${JSON.stringify(owned)}\n`)
  }
  process.stdout.write(`P4-01-PARENT ${JSON.stringify({ id: parent.id, runId: parent.runId ?? null })}\n`)
} finally {
  await ctx.fiber.dispose()
}
// After the clean unload every tracked write has settled.
const stored = JSON.parse(readFileSync(dshHomePath('runs', 'runs.json'), 'utf8')) as { runs: { id: string; sessionIds: string[] }[] }
process.stdout.write(`P4-01-RUNS ${JSON.stringify(stored.runs.map(run => ({ id: run.id, sessionIds: run.sessionIds })))}\n`)
