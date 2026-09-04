/**
 * `RunPlugin`'s Cordis surface: the plugin that turns the durable Run
 * registry into a mounted service with a real caller. Every case mounts a
 * real `Context` with the real agent registry and agent loop, so a Run can
 * only appear the way the harness makes one — from a real agent session
 * start, never from a hand-built `Run` value.
 *
 * `tests/run-service.spec.ts` owns the registry's own durability behavior;
 * this file owns only what mounting adds.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { afterEach, describe, expect, it } from 'vitest'
import RunPlugin, { createFileRunStore, RUN_SERVICE_OWNER_ID, RunService, workflowRefOf } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** An isolated store path owned through teardown, so forked workers never share one. */
async function storePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-plugin-'))
  roots.push(root)
  return join(root, 'runs.json')
}

/**
 * A real Context carrying the agent registry, the agent loop, and the Run
 * plugin over `path`, with no configured agents — each case starts the agent
 * sessions it wants explicitly.
 */
async function harness(path: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(RunPlugin, { storePath: path })
  return ctx
}

describe('RunPlugin mounting', () => {
  it('registers the Run Service on the Context it is mounted into', async () => {
    const ctx = await harness(await storePath())
    expect(ctx.get('runs')).toBeInstanceOf(RunPlugin)
    expect(ctx.runs.service).toBeInstanceOf(RunService)
    await ctx.fiber.dispose()
  })

  it('unregisters the service when the mounting fiber unloads', async () => {
    const ctx = await harness(await storePath())
    await ctx.fiber.dispose()
    expect(ctx.get('runs')).toBeUndefined()
  })

  it('opens no Run before any agent session starts', async () => {
    const ctx = await harness(await storePath())
    expect(ctx.runs.service.listNonTerminal()).toStrictEqual([])
    await ctx.fiber.dispose()
  })
})

describe('RunPlugin agent-session association', () => {
  it('opens exactly one Run for one started agent session', async () => {
    const ctx = await harness(await storePath())
    ctx.agentLoop.create(SessionId('session-alpha'))
    expect(ctx.runs.service.listNonTerminal()).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('owns that Run with RUN_SERVICE_OWNER_ID, never the starting session id', async () => {
    const ctx = await harness(await storePath())
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    const [run] = ctx.runs.service.runsForSession(agent.id)
    expect(run?.ownerId).toBe(RUN_SERVICE_OWNER_ID)
    expect(run?.ownerId).not.toBe(agent.id)
    await ctx.fiber.dispose()
  })

  it('records the opened Run on the live Agent handle as Agent.runId', async () => {
    const ctx = await harness(await storePath())
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    const [run] = ctx.runs.service.runsForSession(agent.id)
    expect(agent.runId).toBe(run?.id)
    await ctx.fiber.dispose()
  })

  it('finds the Run for a live agent through runFor', async () => {
    const ctx = await harness(await storePath())
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    const [run] = ctx.runs.service.runsForSession(agent.id)
    expect(ctx.runs.runFor(agent)).toStrictEqual(run)
    await ctx.fiber.dispose()
  })

  it('opens an independent Run per agent session, so one Session never joins another Session\'s Run', async () => {
    const ctx = await harness(await storePath())
    const alpha = ctx.agentLoop.create(SessionId('session-alpha'))
    const beta = ctx.agentLoop.create(SessionId('session-beta'))
    const [alphaRun] = ctx.runs.service.runsForSession(alpha.id)
    const [betaRun] = ctx.runs.service.runsForSession(beta.id)
    expect(alphaRun?.id).not.toBe(betaRun?.id)
    expect(alphaRun?.sessionIds).toStrictEqual([alpha.id])
    expect(betaRun?.sessionIds).toStrictEqual([beta.id])
    await ctx.fiber.dispose()
  })
})

describe('RunPlugin durability', () => {
  it('writes the Run through to the store, so a fresh service over the same path lists it', async () => {
    const path = await storePath()
    const ctx = await harness(path)
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    await ctx.fiber.dispose()
    const restored = await RunService.restore(createFileRunStore(path))
    expect(restored.runsForSession(agent.id)).toHaveLength(1)
  })

  it('restores the Runs an earlier mount left behind, rather than starting empty', async () => {
    const path = await storePath()
    const first = await harness(path)
    first.agentLoop.create(SessionId('session-alpha'))
    await first.fiber.dispose()
    const second = await harness(path)
    expect(second.runs.service.listNonTerminal()).toHaveLength(1)
    await second.fiber.dispose()
  })
})

describe('workflowRefOf', () => {
  it('reconciles a real WorkflowRunId into the Run event log\'s Workflow reference brand', () => {
    expect(workflowRefOf(WorkflowRunId('workflow-run-1'))).toBe('workflow-run-1')
  })
})
