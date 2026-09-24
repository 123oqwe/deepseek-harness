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
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import { TrackedContexts } from '@deepseek-ai/dsh-agent-loop-testkit'
import { RunId } from '@deepseek-ai/dsh-principal/types'
import RunPlugin, { createFileRunStore, RUN_SERVICE_OWNER_ID, RunService, workflowRefOf } from '../src/index.ts'
import type { RunProvenance } from '../src/types.ts'

const roots: string[] = []
/**
 * Every Context `harness` builds, so teardown disposes the ones a case leaves
 * behind. This file mounts `RunPlugin` over a real store path, so an undisposed
 * mount is one whose in-flight durable write nobody awaits (BLOCKED-229/230).
 */
const contexts = new TrackedContexts()

afterEach(async () => {
  // ORDER IS LOAD-BEARING: dispose before the store directories go, or a live
  // mount finishes its write against a path that has already been removed.
  // Assert the teardown DID tear down rather than that a loop ran: no service
  // a disposed Context provided is still resolvable.
  expect(await contexts.disposeAll()).toEqual([])
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
  const ctx = contexts.track(new Context())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  // The plugin injects `leaseStore`: a Run is a leased work item now, and a
  // mount without a provider opens no Run at all (§12.19-3).
  await ctx.plugin(InMemoryLeaseStorePlugin)
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

describe('RunPlugin durable-write failure reporting', () => {
  it('announces a failed durable write from a mount nobody disposed, instead of rejecting into no one', async () => {
    // BLOCKED-229/230. A Context that is discarded without ever being disposed
    // runs no disposer, so nothing awaits the writes it started. Before this
    // event the rejection reached no caller: the Run's terminal state was lost
    // and the only trace was an unhandled rejection somewhere else entirely.
    const root = await mkdtemp(join(tmpdir(), 'dsh-run-abandoned-'))
    const ctx = await harness(join(root, 'runs.json'))
    const failures: { path: string; error: unknown }[] = []
    ctx.on('run/store-write-failed', (payload) => { failures.push(payload) })

    void ctx.agentLoop.create(SessionId('session-abandoned'))
    // The directory goes while the mount is still live and its write in flight
    // — exactly what a teardown that removes files before disposing produces.
    await rm(root, { recursive: true, force: true })
    const agent = ctx.agents.list()[0]
    if (agent !== undefined) ctx.emit('agent/disposed', { agent })

    await vi.waitFor(() => {
      expect(failures.length).toBeGreaterThan(0)
    })
    expect(failures[0]?.path).toBe(join(root, 'runs.json'))
    // Deliberately NOT disposed: this case is about the mount that never is.
  })
})

describe('RunPlugin agent-session association', () => {
  it('opens exactly one Run for one started agent session', async () => {
    const ctx = await harness(await storePath())
    await ctx.agentLoop.create(SessionId('session-alpha'))
    expect(ctx.runs.service.listNonTerminal()).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('owns that Run with RUN_SERVICE_OWNER_ID, never the starting session id', async () => {
    const ctx = await harness(await storePath())
    const agent = await ctx.agentLoop.create(SessionId('session-alpha'))
    const [run] = ctx.runs.service.runsForSession(agent.id)
    expect(run?.ownerId).toBe(RUN_SERVICE_OWNER_ID)
    expect(run?.ownerId).not.toBe(agent.id)
    await ctx.fiber.dispose()
  })

  it('records the opened Run on the live Agent handle as Agent.runId', async () => {
    const ctx = await harness(await storePath())
    const agent = await ctx.agentLoop.create(SessionId('session-alpha'))
    const [run] = ctx.runs.service.runsForSession(agent.id)
    expect(agent.runId).toBe(run?.id)
    await ctx.fiber.dispose()
  })

  it('finds the Run for a live agent through runFor', async () => {
    const ctx = await harness(await storePath())
    const agent = await ctx.agentLoop.create(SessionId('session-alpha'))
    const [run] = ctx.runs.service.runsForSession(agent.id)
    expect(ctx.runs.runFor(agent)).toStrictEqual(run)
    await ctx.fiber.dispose()
  })

  it('opens an independent Run per root session, and only a session the registry records as owned joins another\'s Run', async () => {
    const path = await storePath()
    const ctx = await harness(path)
    const alpha = await ctx.agentLoop.create(SessionId('session-alpha'))
    const beta = await ctx.agentLoop.create(SessionId('session-beta'))
    const { agent: gamma } = await alpha.ctx.agents.create({
      sessionId: SessionId('session-gamma'), parentAgent: alpha, meta: { parentSession: alpha.id },
    })
    const [alphaRun, betaRun, gammaRun] = [alpha.runId!, beta.runId!, gamma.runId!]
    expect(new Set([alphaRun, betaRun, gammaRun]).size).toBe(3)
    // Read after every write has settled, so a join that lands late is seen.
    await ctx.fiber.dispose()
    const stored = await RunService.restore(createFileRunStore(path))
    expect(stored.get(alphaRun)?.sessionIds).toStrictEqual([alpha.id, gamma.id])
    expect(stored.get(betaRun)?.sessionIds).toStrictEqual([beta.id])
    expect(stored.get(gammaRun)?.sessionIds).toStrictEqual([gamma.id])
  })
})

describe('P8-01 acceptance[4]: a subagent\'s Run takes the provenance of the Run its parent agent is in (blind review B1)', () => {
  const fromA = { negotiation: { protocolVersion: 1, agreedCapabilities: [], ignoredCapabilities: ['x-from-a'], downgrades: [] } }
  const fromB = { negotiation: { protocolVersion: 1, agreedCapabilities: [], ignoredCapabilities: ['x-from-b'], downgrades: [] } }
  const FINISHED = RunId('run-finished-by-a')

  /**
   * A store in which session-alpha already has a finished Run carrying SDK connection A's negotiation, as a session
   * has when a host continues it after that connection shut down.
   * @returns the store path.
   */
  async function storeWithFinishedRun(): Promise<string> {
    const path = await storePath()
    const seeded = await RunService.restore(createFileRunStore(path))
    await seeded.accept(FINISHED, SessionId('session-alpha'), 1_000)
    await seeded.recordProvenance(FINISHED, fromA)
    expect((await seeded.advance(FINISHED, 'cancelled', [], 1_100)).accepted).toBe(true)
    return path
  }

  /**
   * Start a subagent of `parent`, then read its Run's provenance once every write has settled.
   * @returns the provenance the store holds for the subagent's Run.
   */
  async function childProvenance(ctx: Context, path: string, parent: Agent): Promise<RunProvenance | undefined> {
    const { agent: child } = await parent.ctx.agents.create({
      sessionId: SessionId('session-gamma'), parentAgent: parent, meta: { parentSession: parent.id },
    })
    const childRun = child.runId!
    await ctx.fiber.dispose()
    return (await RunService.restore(createFileRunStore(path))).get(childRun)?.provenance
  }

  it('gives none when the parent\'s current Run has none, though a finished Run of its session does', async () => {
    const path = await storeWithFinishedRun()
    const ctx = await harness(path)
    const alpha = await ctx.agentLoop.create(SessionId('session-alpha'))
    // The finished Run is not continued: alpha works in a Run of its own, which carries no provenance.
    expect(alpha.runId).not.toBe(FINISHED)

    expect(await childProvenance(ctx, path, alpha)).toBeUndefined()
  })

  it('gives the provenance of the parent\'s current Run, not a finished one\'s', async () => {
    const path = await storeWithFinishedRun()
    const ctx = await harness(path)
    const alpha = await ctx.agentLoop.create(SessionId('session-alpha'))
    await ctx.runs.service.recordProvenance(alpha.runId!, fromB)

    expect(await childProvenance(ctx, path, alpha)).toEqual(fromB)
  })

  it('gives none when the parent\'s own Run has reached a terminal state', async () => {
    const path = await storePath()
    const ctx = await harness(path)
    const alpha = await ctx.agentLoop.create(SessionId('session-alpha'))
    await ctx.runs.service.recordProvenance(alpha.runId!, fromA)
    expect((await ctx.runs.service.advance(alpha.runId!, 'cancelled', [], Date.now())).accepted).toBe(true)

    expect(await childProvenance(ctx, path, alpha)).toBeUndefined()
  })
})

describe('RunPlugin durability', () => {
  it('writes the Run through to the store, so a fresh service over the same path lists it', async () => {
    const path = await storePath()
    const ctx = await harness(path)
    const agent = await ctx.agentLoop.create(SessionId('session-alpha'))
    await ctx.fiber.dispose()
    const restored = await RunService.restore(createFileRunStore(path))
    expect(restored.runsForSession(agent.id)).toHaveLength(1)
  })

  it('restores the Runs an earlier mount left behind, rather than starting empty', async () => {
    const path = await storePath()
    const first = await harness(path)
    await first.agentLoop.create(SessionId('session-alpha'))
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
