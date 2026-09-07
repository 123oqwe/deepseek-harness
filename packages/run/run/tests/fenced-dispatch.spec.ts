/**
 * The Run's lease as an authority the harness actually presents (Epic P4-07
 * must[1]/must[3], §12.19-3).
 *
 * **This is the production caller `advanceAgentLifecycleFenced` did not have.**
 * The fencing rule, the store, the lifecycle state machine and the fenced
 * entry point all existed through P4-05 and P4-07's Contract stages with, as
 * measured for the withdrawal, zero production callers of either the store's
 * acquire or the fenced advance. A rule nothing holds refuses nothing.
 *
 * The cases below drive a REAL agent session through the mounted Run Service,
 * take its Run's lease away the way a scheduler would, and assert the next
 * state write is refused. Nothing is hand-built: the lifecycle comes from
 * `RunPlugin.open`, the epoch from the store, and the refusal from
 * `checkFencing` reading the store's current lease.
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
import LlmRuntime, { createUserMessage, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin from '../src/index.ts'

const roots: string[] = []
const mounted: Context[] = []

// Dispose BEFORE removing the directory. `RunPlugin`'s disposer awaits the
// durable writes it started, and a case that only removed the root raced them:
// the write landed back into a directory `rm` had just emptied, and the case
// failed with ENOTEMPTY on teardown rather than on anything it asserted.
afterEach(async () => {
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** One assistant message carrying several tool calls, as the loop parses them. */
function multiCall(calls: { id: string; name: string; args: object }[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: JSON.stringify(call.args) } },
    )
  })
  chunks.push(
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

async function harness(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-fenced-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(root, 'runs.json'), leaseMs: 1000 })
  mounted.push(ctx)
  return ctx
}

describe('the Run lease is an authority the harness presents (P4-07 must[1], §12.19-3)', () => {
  it('takes a lease for every Run it opens, so the Run has an owner before it has work', async () => {
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    const runId = agent.runId
    expect(runId).toBeDefined()
    // The store, not the agent, is asked. A lifecycle carrying an epoch nobody
    // issued is exactly what this epic refuses, so the assertion reads the
    // issuer.
    const held = ctx.leaseStore.get(brandString<WorkItemId>(runId!))
    expect(held?.workItem).toBe(runId)
    expect(agent.lifecycle?.epoch).toBe(held?.epoch)
  })

  it('starts the lifecycle at queued, so a run that never steps is never running', async () => {
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    expect(agent.lifecycle?.state).toBe('queued')
  })

  it('REFUSES a state write once another holder has taken the Run, naming it fenced', async () => {
    // The whole point. A scheduler reclaiming an expired Run and a stale host
    // waking up are the same instant from the store's side; the store issues a
    // greater epoch to the new holder, and the old holder's token stops being
    // current. Nothing tells the old holder — it finds out here.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    const workItem = brandString<WorkItemId>(agent.runId!)

    const stolen = ctx.leaseStore.acquire(
      workItem,
      brandString<WorkerId>('a-different-host'),
      // Past the lease this mount was granted, which is the condition under
      // which the scheduler may reclaim (must[2]).
      Date.now() + 5_000,
      1_000,
    )
    expect(stolen.acquired).toBe(true)

    expect(ctx.runs.advance(agent, 'starting', 'the run is taking its first model step')).toBe('fenced')
    // And the lifecycle did not move: a refused transition writes nothing.
    expect(agent.lifecycle?.state).toBe('queued')
  })

  it('ADMITS the same write while this holder is still current, so the refusal is about authority and not about the transition', async () => {
    // The positive control the refusal above needs. Without it the case would
    // pass against an `advance` that refused everything.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    expect(ctx.runs.advance(agent, 'starting', 'the run is taking its first model step')).toBeUndefined()
    expect(agent.lifecycle?.state).toBe('starting')
  })

  it('refuses an ILLEGAL transition with the state machine\'s own reason, not with fenced', async () => {
    // The two refusals must stay distinguishable: `fenced` says another host
    // owns this run and this one must stop, `illegal-transition` says this
    // host asked for something the lifecycle does not allow. Reporting either
    // as the other would make a routing bug look like a failover.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    expect(ctx.runs.advance(agent, 'waiting_tool', 'skipping straight to a tool wait')).toBe('illegal-transition')
  })

  it('refuses a transition with an empty reason, so must[1]\'s reason cannot be satisfied by whitespace', async () => {
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    expect(ctx.runs.advance(agent, 'starting', '   ')).toBe('missing-reason')
  })

  it('reports no-run for an agent with no lifecycle, rather than inventing one at its initial state', async () => {
    // A composition without the Run Service, and a Run whose lease was
    // refused, reach this path. Treating absence as `queued` would let an
    // unleased agent advance through a state machine no store backs.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    delete agent.lifecycle
    expect(ctx.runs.advance(agent, 'starting', 'no lifecycle here')).toBe('no-run')
  })

  it('REFUSES every tool call in a step once this host was fenced out, and says so in the log', async () => {
    // The dispatch-side half of must[1]: the authority is presented where the
    // state write happens, which for an agent run is the tool dispatch. A host
    // that lost its Run must not execute a single call, and the model must see
    // that its calls did not run — a silent drop would leave the turn's log
    // claiming calls that neither executed nor failed.
    const ctx = await harness()
    let executed = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'records that it ran',
      parameters: {},
      execute() {
        executed += 1
        return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
      },
    }))
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'noop', args: {} }, { id: 'c2', name: 'noop', args: {} }]),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('session-fenced'), { provider: 'mock', model: 'mock' })

    // Another host takes the Run before the model's calls are dispatched.
    ctx.leaseStore.acquire(
      brandString<WorkItemId>(agent.runId!),
      brandString<WorkerId>('a-different-host'),
      Date.now() + 5_000,
      1_000,
    )

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(executed).toBe(0)
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(2)
    for (const result of results) {
      // Asserted on the MODEL-VISIBLE content, not only on the error record:
      // what matters is that the model is told its calls did not run. The
      // `FencedError` name is what separates this from an ordinary abort,
      // which a reader of the log needs in order to know not to retry.
      expect(result.data.error?.name).toBe('FencedError')
      const block = result.data.message.content[0]
      expect(block?.type === 'tool-result' && block.isError).toBe(true)
      expect(block?.type === 'tool-result' && block.content[0]?.type === 'text' && block.content[0].text)
        .toBe('Error: this run is no longer the owner of its work item')
    }
  })

  it('EXECUTES the same calls while this host still owns its Run, so the refusal is about the lease', async () => {
    // The positive control. Without it the case above passes against a
    // dispatch that refuses everything.
    const ctx = await harness()
    let executed = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'records that it ran',
      parameters: {},
      execute() {
        executed += 1
        return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
      },
    }))
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'noop', args: {} }, { id: 'c2', name: 'noop', args: {} }]),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('session-owned'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(executed).toBe(2)
    expect(agent.lifecycle?.state).toBe('running')
  })

  it('opens NO Run when the lease store refuses, so an unauthorized agent gets no Run rather than an unowned one', async () => {
    // acceptance[2]'s stop-work at the Run boundary. The store being
    // unreachable and the item being held are different answers, and only the
    // first means "start nothing".
    const ctx = await harness()
    ctx.leaseStore.setAvailable(false)
    const agent = ctx.agentLoop.create(SessionId('session-beta'))
    expect(agent.runId).toBeUndefined()
    expect(agent.lifecycle).toBeUndefined()
  })
})
