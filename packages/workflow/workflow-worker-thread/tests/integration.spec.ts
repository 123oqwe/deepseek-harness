import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import LeaseStorePlugin from '@deepseek-ai/dsh-lease-sqlite'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { LeaseStoreContract, WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease-contract'

type Script = ConstructorParameters<typeof MockAdapter>[0]

async function mountInvariants(ctx: Context): Promise<void> {
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
}

/**
 * The whole in-process stack, keyless, with the script in a REAL worker
 * thread: the engine drives the REAL spawn backend (with its
 * structured runtime) on a real agent loop; the scripted mock MODEL is the
 * only mocked boundary. This is the guard the unit suites structurally
 * cannot give — the MessageChannel suite fakes the host, and the host suite
 * stubs the subagent seam.
 */
const leaseRoots: string[] = []
afterEach(() => { for (const root of leaseRoots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function setup(script: Script) {
  const ctx = new Context()
  const adapter = new MockAdapter(script)
  await mountAgentLoopTestDependencies(ctx)
  await mountInvariants(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  // The engine INJECTS its lease store, so the stack must mount a provider
  // for it — the same wiring a profile does. A temp directory per setup: the
  // store is a real file now, and a suite that wrote it into the repository
  // root would leave `.dsh/leases.sqlite` behind and let one case's leases
  // reach the next.
  const directory = mkdtempSync(join(tmpdir(), 'workflow-leases-'))
  leaseRoots.push(directory)
  await ctx.plugin(LeaseStorePlugin, { directory })
  await ctx.plugin(WorkerThreadWorkflowEngine, {})
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter }
}

describe('dsh-workflow-worker-thread over the real in-process stack', () => {
  it('runs a two-stage workflow: a plain child, then a schema child through the structured runtime', async () => {
    const { ctx, parent } = await setup([
      textResponse('the file list is a.ts'),
      toolCallResponse('c1', STRUCTURED_OUTPUT_TOOL, { verdict: 'real', confidence: 0.9 }),
    ])
    const childIds: string[] = []
    ctx.on('workflow/agent-start', (_info, agent) => {
      // The workflow bridge must await asynchronous provider start: an observer
      // sees the real spawn child already published, never a reserved id.
      expect(ctx.agents.get(agent.childId)).toBeDefined()
      childIds.push(agent.childId)
    })
    const run = ctx.workflowEngine.start({
      meta: { name: 'integration', description: 'plain + structured children' },
      script: `phase('Read')
const prose = await agent('read the repo')
phase('Judge')
const judged = await agent('judge: ' + prose, {
  schema: { type: 'object', properties: { verdict: { type: 'string', enum: ['real', 'bogus'] }, confidence: { type: 'number' } }, required: ['verdict'] },
})
return { prose, verdict: judged.verdict, confidence: judged.confidence }`,
      parent,
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.value).toEqual({ prose: 'the file list is a.ts', verdict: 'real', confidence: 0.9 })
    expect(result.agentsStarted).toBe(2)
    await run.dispose()
    // Both children were disposed to quiescence — no live child agents remain.
    expect(childIds.length).toBe(2)
    for (const childId of childIds) {
      expect(ctx.agents.get(SessionId(childId))).toBeUndefined()
    }
  })

  it('a child that fails against its schema (nudges exhausted) reaches the script as null', async () => {
    const { ctx, parent } = await setup([
      textResponse('prose only'),
      textResponse('still prose after the nudge'),
    ])
    const run = ctx.workflowEngine.start({
      meta: { name: 'null-path', description: 'schema failure maps to null' },
      script: `const judged = await agent('judge it', { schema: { type: 'object', properties: { v: { type: 'string' } } } })
return { got: judged === null ? 'null' : 'value' }`,
      parent,
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.value).toEqual({ got: 'null' })
    await run.dispose()
  })
})

describe('P4-07 Usage: a workflow run holds an epoch lease on the real stack', () => {
  // BLOCKED (§12.15): the lease package's `acquire`/`renew`/`checkFencing` and
  // `dsh-agent`'s `advanceAgentLifecycleFenced` had, measured, ZERO production
  // callers while P4-07 was ACCEPTED. A fencing rule nothing holds refuses
  // nothing. These cases run against the engine mounted on the real stack, so
  // what they observe is the product's behaviour rather than a library's.

  it('must[0]: a run takes a lease, and a second host cannot take the same item while it is held', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const engine = ctx.workflowEngine as unknown as { leases: LeaseStoreContract }
    const run = ctx.workflowEngine.start({
      meta: { name: 'leased', description: 'holds a lease' },
      script: "return 'ok'",
      parent,
    })
    const held = engine.leases.get(brandString<WorkItemId>(run.id))
    expect(held, 'the run must own its work item while it is live').toBeDefined()

    // A second host presenting a different worker id is refused while the
    // lease stands — which is the whole of must[0].
    const second = engine.leases.acquire(brandString<WorkItemId>(run.id), brandString<WorkerId>('other-host'), Date.now(), 30_000)
    expect(second).toMatchObject({ acquired: false, reason: 'held-by-another' })
    await run.result
  })

  it('acceptance[2]: no new run starts while the lease store is unavailable', async () => {
    // Stop-work, not best-effort: a store that cannot answer cannot say whether
    // another host already owns this item, and starting anyway is how two
    // masters happen.
    const { ctx, parent } = await setup([textResponse('done')])
    const engine = ctx.workflowEngine as unknown as { leases: LeaseStoreContract }
    engine.leases.setAvailable(false)
    expect(() => ctx.workflowEngine.start({
      meta: { name: 'unavailable', description: 'refused' },
      script: "return 'ok'",
      parent,
    })).toThrow(/lease store could not be reached/u)
  })

  it('acceptance[0]: a reclaimed run cannot write its terminal state', async () => {
    // The old worker recovers and finds it has been fenced out. Its result
    // exists — the script ran — but the run's OUTCOME belongs to whoever holds
    // the item now, and a second `workflow/end` for one run is the
    // two-masters state this epic exists to prevent.
    const { ctx, parent } = await setup([textResponse('done')])
    const engine = ctx.workflowEngine as unknown as { leases: LeaseStoreContract }
    const ends: unknown[] = []
    ctx.on('workflow/end', (info: unknown) => { ends.push(info) })
    const run = ctx.workflowEngine.start({
      meta: { name: 'reclaimed', description: 'loses its lease' },
      script: "return 'ok'",
      parent,
    })
    // Another host reclaims the item by acquiring it after the lease expires.
    const item = brandString<WorkItemId>(run.id)
    engine.leases.acquire(item, brandString<WorkerId>('reclaiming-host'), Date.now() + 60_000, 30_000)
    await run.result
    expect(ends, 'a fenced-out host must not report the run outcome').toHaveLength(0)
  })

  it('control: an unreclaimed run DOES report its outcome, so the refusal above is selective', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const ends: unknown[] = []
    ctx.on('workflow/end', (info: unknown) => { ends.push(info) })
    const run = ctx.workflowEngine.start({
      meta: { name: 'kept', description: 'keeps its lease' },
      script: "return 'ok'",
      parent,
    })
    await run.result
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(ends).toHaveLength(1)
  })
})
