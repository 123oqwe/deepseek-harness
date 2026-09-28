/**
 * P4-05 on the Run plugin, blind review 2-3 and 2-4 (B-678): the mount-time
 * sweep of restored Runs whose sessions are all gone checks every Run even when
 * checking one of them fails, and a Run whose agent lifecycle ended `failed` is
 * recorded `failed`, whoever moved the lifecycle there.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin from '../src/index.ts'

const roots: string[] = []
const mounted: Context[] = []

afterEach(async () => {
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/**
 * A Run store path in a fresh temporary directory.
 * @returns the path.
 */
async function storePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-end-state-'))
  roots.push(root)
  return join(root, 'runs.json')
}

/**
 * Mount the agent loop and the Run plugin over an in-memory lease store.
 * @param path - the Run store path.
 * @returns the context.
 */
async function mount(path: string): Promise<Context> {
  const ctx = new Context()
  mounted.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: path })
  return ctx
}

describe('P4-05 acceptance[2]: the sweep of restored Runs with no session left checks every Run (blind review 2-3)', () => {
  it('still fails a later restored Run whose sessions are gone when checking an earlier one throws', async () => {
    const path = await storePath()
    const first = await mount(path)
    const alpha = await first.agentLoop.create(SessionId('sweep-alpha'))
    const beta = await first.agentLoop.create(SessionId('sweep-beta'))
    const alphaRun = alpha.runId
    const betaRun = beta.runId
    if (alphaRun === undefined || betaRun === undefined) throw new Error('the Run plugin opened no Run')
    // A clean unload leaves both Runs `accepted`, so the next mount restores them.
    await first.fiber.dispose()
    mounted.length = 0

    const second = await mount(path)
    second.provide('sessionPersistence', {
      stat: (id: SessionId) => id === SessionId('sweep-alpha')
        ? Promise.reject(new Error('the session store cannot answer'))
        : Promise.resolve(undefined),
    } as never)

    await vi.waitFor(() => { expect(second.runs.service.get(betaRun)?.state).toBe('failed') })
    expect(second.runs.service.get(alphaRun)?.state).toBe('accepted')
  })
})

describe('P4-05 must[0]: a Run ends in the state its lifecycle ended in (blind review 2-4)', () => {
  it('records the Run failed, not succeeded, when its lifecycle was ended failed through runs.advance', async () => {
    const path = await storePath()
    const ctx = await mount(path)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
    const handle = await ctx.agents.create({
      sessionId: SessionId('ended-through-advance'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const runId = handle.agent.runId
    if (runId === undefined) throw new Error('the Run plugin opened no Run')
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do the thing' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(ctx.runs.advance(handle.agent, 'failed', 'a supervisor ended the run')).toBeUndefined()

    await handle.dispose()

    await vi.waitFor(() => { expect(ctx.runs.service.get(runId)?.state).toBe('failed') })
    expect(ctx.runs.service.get(runId)?.events.map(event => event.toState))
      .toEqual(['accepted', 'planning', 'running', 'verifying', 'failed'])
  })
})
