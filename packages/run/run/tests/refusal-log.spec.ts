/**
 * P4-07 must[1]: a Run write the Run Service refuses for the writer's lease is
 * logged. The refusal writes nothing and `RunPlugin` has no other move after
 * it, so the warning is the only trace a fenced host leaves.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { brandString } from '@deepseek-ai/dsh-brand'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import type { WorkerId, WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunPlugin from '../src/index.ts'

const roots: string[] = []
const mounted: Context[] = []

// Dispose before removing the directory: the plugin's disposer awaits the Run
// store writes it started.
afterEach(async () => {
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function harness(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-refusal-log-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(root, 'runs.json'), leaseMs: 1_000 })
  mounted.push(ctx)
  return ctx
}

/**
 * The arguments of every warning that reports a refused Run write.
 * @param warn - the spy on `ctx.logger.warn`.
 * @returns one argument list per refusal warning.
 */
function refusals(warn: { mock: { calls: unknown[][] } }): unknown[][] {
  return warn.mock.calls.filter(call => String(call[0]).startsWith('run: the Run write '))
}

describe('P4-07 must[1]: a Run write refused for its lease is logged', () => {
  it('logs the cancellation a displaced host was refused, naming the pair, the Run and the reason', async () => {
    const ctx = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    const handle = await ctx.agents.create({ sessionId: SessionId('session-displaced') })
    const runId = handle.agent.runId
    const workItem = brandString<WorkItemId>(handle.agent.id)
    // Past the lease's term, so the store hands the item to a second host.
    const taken = ctx.leaseStore.acquire(workItem, brandString<WorkerId>('a-second-host'), Date.now() + 1_001, 1_000)
    expect(taken.acquired).toBe(true)

    await handle.dispose()

    await vi.waitFor(() => {
      expect(refusals(warn)).toEqual([[expect.any(String), 'accepted', 'cancelled', runId, 'fenced']])
    }, { timeout: 1_000 })
  })

  it('logs no refusal for the same session end while this host still holds its lease (control)', async () => {
    const ctx = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    const handle = await ctx.agents.create({ sessionId: SessionId('session-holder') })
    const runId = handle.agent.runId
    if (runId === undefined) throw new Error('the holder opened no Run')

    await handle.dispose()

    await vi.waitFor(() => { expect(ctx.runs.service.get(runId)?.state).toBe('cancelled') }, { timeout: 1_000 })
    expect(refusals(warn)).toEqual([])
  })
})
