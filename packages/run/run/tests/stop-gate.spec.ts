/**
 * P2-12 must[2] where the Run plugin takes its lease: a session that starts
 * under an emergency stop opens no Run, and the reason it records is the stop.
 *
 * The production path, not the library's: an agent session starts, `open` takes
 * the session's work item through `acquireRunLease`, and the mounted lease
 * provider refuses. What this file adds to the provider's own conformance table
 * is what the CALLER does with that refusal — the reason reaches the log under
 * its own name, and no Run, lifecycle or epoch is created for work the stop
 * forbade.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { TrackedContexts } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import ControlPlaneService from '@deepseek-ai/dsh-control-plane/plugin'
import type { ControlRequest } from '@deepseek-ai/dsh-control-plane/channel'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunPlugin from '../src/index.ts'

const roots: string[] = []
const contexts = new TrackedContexts()

afterEach(async () => {
  // Dispose before the directories go: a live mount would otherwise finish its
  // durable write against a path that has already been removed.
  expect(await contexts.disposeAll()).toEqual([])
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/**
 * A directory owned through teardown.
 * @param prefix - what it holds, so a leftover names itself.
 * @returns the directory path.
 */
async function directory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

const REQUEST: ControlRequest = {
  requestedBy: brandString<PrincipalId>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
}

/**
 * The agent stack with a Run plugin, a lease provider and a control plane.
 * @returns the mounted context.
 */
async function harness(): Promise<Context> {
  const ctx = contexts.track(new Context())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ControlPlaneService, { storePath: await directory('dsh-run-stop-plane-') })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(await directory('dsh-run-stop-'), 'runs.json') })
  return ctx
}

describe('P2-12 must[2]: a session that starts under a stop gets no Run', () => {
  it('opens no Run and records the refusal as the stop, not as another host holding the item', async () => {
    const ctx = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    ctx.get('controlPlane')?.control('pause-new-actions', REQUEST)
    const agent = await ctx.agentLoop.create(SessionId('stopped-session'))
    // No Run, no lifecycle, no epoch: nothing that a later write could present
    // as authority for work the stop forbade.
    expect(agent.runId).toBeUndefined()
    expect(agent.lifecycle).toBeUndefined()
    // Marked rather than merely absent, which is what keeps dispatch from
    // reading "no Run service here" and proceeding.
    expect(agent.leaseRefused).toBe(true)
    // The sentence an operator gets. `held-by-another` here would send them
    // looking for a second host that does not exist.
    expect(warn.mock.calls.flat()).toContain('stopped')
    expect(warn.mock.calls.flat()).not.toContain('held-by-another')
  })

  it('opens a Run for the same session shape when no stop is in force', async () => {
    // The positive control: the refusal above is the stop's doing and not this
    // harness failing to open Runs at all.
    const ctx = await harness()
    const agent = await ctx.agentLoop.create(SessionId('running-session'))
    expect(agent.runId).toBeDefined()
    expect(agent.leaseRefused).toBeUndefined()
  })
})
