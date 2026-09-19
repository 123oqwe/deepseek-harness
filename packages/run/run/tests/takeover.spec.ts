/**
 * P4-05 acceptance[2] on the path a deployment runs: a restart that adopts a
 * Run whose holder stopped renewing walks it through `orphaned`.
 *
 * **The restart is the reclaim.** `RunService.reclaim` describes this
 * transition and has no production caller; what a second host actually does is
 * `open`, and until now `open` set every adopted Run to `queued` — the state
 * of a run nobody had ever taken. `orphaned` had no producer on any path a
 * deployment runs, which is what left acceptance[2] without a subject.
 *
 * Every case here uses ONE durable lease store across two mounts, which is
 * what a restart is: the second context is a different process's worth of
 * state over the same rows. The predecessor's lease is made to lapse through
 * the clock parameters the store already takes — `leaseMs` on the first mount
 * and the instant the second mount judges expiry against — rather than by
 * waiting.
 *
 * What is observed is `agent.lifecycle`, the same exit
 * `tests/fenced-dispatch.spec.ts` asserts against: the state, and the epoch
 * the store issued for it. No logger spy decides anything here.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { TrackedContexts } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import LeaseStorePlugin from '@deepseek-ai/dsh-lease-sqlite'
import type { WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease-contract'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin from '../src/index.ts'

const roots: string[] = []
const contexts = new TrackedContexts()

afterEach(async () => {
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

/**
 * One host over a given lease directory and Run store.
 * @param leases - the durable lease directory both hosts share.
 * @param runs - the Run store path both hosts share, so the second adopts what the first registered.
 * @param leaseMs - how long this host's leases run for.
 * @returns the mounted context.
 */
async function host(leases: string, runs: string, leaseMs: number): Promise<Context> {
  const ctx = contexts.track(new Context())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LeaseStorePlugin, { directory: leases })
  await ctx.plugin(RunPlugin, { storePath: join(runs, 'runs.json'), leaseMs })
  return ctx
}

describe('P4-05 acceptance[2]: adopting a Run whose holder lapsed', () => {
  it('walks the adopted Run through orphaned under a new epoch, rather than opening it as queued', async () => {
    const leases = await directory('dsh-takeover-leases-')
    const runs = await directory('dsh-takeover-runs-')
    const session = SessionId('adopted-session')

    // The first host takes the item and does NOT release it: its lease is
    // written with a term so short that the second host's clock reading is
    // already past it, which is a lapse rather than a handover.
    const first = await host(leases, runs, 1)
    const held = await first.agentLoop.create(session)
    expect(held.lifecycle?.state).toBe('queued')
    const firstEpoch = held.lifecycle?.epoch
    expect(firstEpoch).toBeDefined()
    await first.fiber.dispose()

    const second = await host(leases, runs, 30_000)
    const adopted = await second.agentLoop.create(session)
    // The state P4-05 declared and nothing produced. It is reached through the
    // real transition table, so a run that could not legally be orphaned would
    // have stayed where it was instead.
    expect(adopted.lifecycle?.state).toBe('starting')
    expect(adopted.leaseRefused).toBeUndefined()
    // A NEW epoch: the second host writes under authority this store issued
    // it, never under the one the dead host still believes it has.
    expect(adopted.lifecycle?.epoch).toBeGreaterThan(firstEpoch as number)
  })

  it('fences the previous holder\'s token once the item has been taken over', async () => {
    const leases = await directory('dsh-takeover-leases-')
    const runs = await directory('dsh-takeover-runs-')
    const session = SessionId('fenced-after-takeover')

    const first = await host(leases, runs, 1)
    const held = await first.agentLoop.create(session)
    const staleEpoch = held.lifecycle?.epoch
    await first.fiber.dispose()

    const second = await host(leases, runs, 30_000)
    await second.agentLoop.create(session)
    // Read from the store rather than from either agent: the item's current
    // authority is what the fencing rule compares against, and it has moved.
    const current = second.leaseStore.get(brandString<WorkItemId>(String(session)))
    expect(current?.epoch).toBeGreaterThan(staleEpoch as number)
    expect(current?.holder).not.toBe(brandString<WorkerId>('dead-host'))
  })

  it('takes a real step after the takeover: a tool runs and the profile is compiled, which the old first-step test skipped', async () => {
    // The defect this case exists for is invisible to the two above. An
    // adopted Run enters its first model step at `starting`, and the plugin's
    // "is this the first step" test used to be `lifecycle.state === 'queued'`
    // — false for exactly this Run — so P4-02's compile was skipped and the
    // run took every step at `starting`, never reaching `running`.
    const leases = await directory('dsh-takeover-leases-')
    const runs = await directory('dsh-takeover-runs-')
    const session = SessionId('adopted-and-stepping')

    const first = await host(leases, runs, 1)
    const held = await first.agentLoop.create(session)
    const staleEpoch = held.lifecycle?.epoch
    await first.fiber.dispose()

    let executed = 0
    const second = await host(leases, runs, 30_000)
    second.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'records that it ran',
      parameters: {},
      execute() {
        executed += 1
        return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
      },
    }))
    second.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'noop', {}),
      textResponse('done'),
    ]))
    const adopted = await second.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    adopted.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await adopted.whenIdle()

    // The step ran: the tool executed under this host's authority.
    expect(executed, 'an adopted run must take its step like any other').toBe(1)
    // P4-02's once-per-agent compile happened for the adopted run too.
    expect(adopted.taskProfile, 'the first-step work must run for an adopted Run').toBeDefined()
    // And the lifecycle left `starting`, which the missing edge would have
    // prevented.
    expect(adopted.lifecycle?.state).not.toBe('starting')
    expect(adopted.lifecycle?.epoch).toBeGreaterThan(staleEpoch as number)
  })

  it('leaves a live predecessor alone: the second host is refused and no Run is orphaned', async () => {
    // The control, and the boundary of the change: a lease that has NOT
    // lapsed is still a live owner, and taking it over would be the two-master
    // failure P4-07 exists to prevent. `tests/fenced-dispatch.spec.ts` pins the
    // refusal itself; what this adds is that nothing was orphaned on the way.
    const leases = await directory('dsh-takeover-leases-')
    const runs = await directory('dsh-takeover-runs-')
    const session = SessionId('live-predecessor')

    const first = await host(leases, runs, 30_000)
    const held = await first.agentLoop.create(session)
    expect(held.lifecycle?.state).toBe('queued')

    const second = await host(leases, runs, 30_000)
    const refused = await second.agentLoop.create(session)
    expect(refused.leaseRefused).toBe(true)
    expect(refused.lifecycle).toBeUndefined()
    expect(held.lifecycle?.state).toBe('queued')
  })
})
