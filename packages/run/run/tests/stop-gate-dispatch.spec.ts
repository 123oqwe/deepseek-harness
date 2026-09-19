/**
 * P2-12 must[2] on the path that actually spends money: an emergency stop
 * refuses the tool calls, not only the next lease.
 *
 * **The stop had one reach and it was the wrong half.** `stopGateFor` is
 * consulted by `advanceLeasedAgent`, which returns `'stopped'` — and, measured
 * across the tree, NO caller read that answer: `tool-calls.ts` short-circuits
 * only on `'fenced'` and `'lease-refused'`, `external-effect.ts` discards the
 * return entirely, and `dsh-run`'s own wrapper passes it through to callers
 * that ignore it. The only place a stop refused anything was the lease
 * acquisition for a NEW Run, which is the half `acceptance[0]`'s two P cases
 * already pin. A stop raised while a run was in flight stopped nothing it was
 * already doing.
 *
 * These cases drive a real agent session through the mounted Run Service, with
 * a real control plane holding a real stop record, and assert what the TOOL
 * observed and what the MODEL was told. Nothing is hand-built: the stop comes
 * from `controlPlane.control`, the state reaches the agent through the
 * channel's own broadcast, and the refusal text is the one a model would read.
 *
 * **The last describe here is P4-07's, not P2-12's.** `refuseNewAction` carries
 * the stop and the fencing arm in one function, so the harness a stop case
 * needs is the harness a fencing case needs -- the same Run Service, the same
 * lease store, the same PTC runtime. Those cases live here rather than in
 * `fenced-dispatch.spec.ts` because that file fences a host BEFORE the step and
 * observes the batch-level check; what was unobserved is the PER-CALL one, and
 * duplicating this file's harness to say so would have been the more expensive
 * of the two wrongs.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { TrackedContexts } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import ControlPlaneService from '@deepseek-ai/dsh-control-plane/plugin'
import type { ControlRequest } from '@deepseek-ai/dsh-control-plane/channel'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import type { WorkerId, WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import LlmRuntime, { createUserMessage, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME, defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin from '../src/index.ts'

const roots: string[] = []
const contexts = new TrackedContexts()

afterEach(async () => {
  expect(await contexts.disposeAll()).toEqual([])
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const REQUEST: ControlRequest = {
  requestedBy: brandString<PrincipalId>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
}

/**
 * A code runtime whose program this case writes.
 *
 * The one stand-in in this file, and the same one every PTC case in the
 * repository uses: what is under test is the sub-dispatch guard chain, not a
 * language runtime. Everything the guard reads — the agent, its control state,
 * the stop record — is real.
 */
class FakeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  /** The program, set by the case before the model asks for `run_code`. */
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })

  /**
   * Run the case's program.
   * @param request - the bindings the PTC layer built for this run.
   * @returns whatever the program returned.
   */
  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.behavior(request)
  }
}

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
 * One assistant message carrying any number of tool calls.
 *
 * Several blocks in ONE message rather than several messages, because that is
 * what a batch is: the calls the model asked for together, which the loop
 * dispatches without going back to the model in between. A stop that arrives
 * mid-batch has no second model turn to be noticed at.
 * @param blocks - the calls, in the order the model emitted them.
 * @returns the stream chunks the mock adapter replays.
 */
function calls(blocks: readonly { id: string; name: string; args: object }[]): StreamChunk[] {
  return [
    ...blocks.flatMap((block, index): StreamChunk[] => [
      { type: 'block-start', index, blockType: 'tool-call' },
      {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id: ToolCallId(block.id), name: block.name, arguments: JSON.stringify(block.args) },
      },
    ]),
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/**
 * A harness with a real Run Service, and a real control plane when asked for.
 * @param adapter - the scripted model.
 * @param options - `plane` mounts the control plane; `maxParallelToolCalls` sequences a batch.
 * @returns the mounted context.
 */
async function harness(
  adapter: MockAdapter,
  options: { plane?: boolean; maxParallelToolCalls?: number; ptc?: boolean } = {},
): Promise<Context> {
  const ctx = contexts.track(new Context())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, options.ptc === true ? { mode: 'ptc' } : {})
  if (options.ptc === true) await ctx.plugin(FakeRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, {
    agents: [],
    ...options.maxParallelToolCalls === undefined ? {} : { maxParallelToolCalls: options.maxParallelToolCalls },
  })
  if (options.plane === true) await ctx.plugin(ControlPlaneService, { storePath: await directory('dsh-stop-gate-plane-') })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(await directory('dsh-stop-gate-runs-'), 'runs.json'), leaseMs: 30_000 })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/**
 * Every tool result the session recorded, as flat text, in dispatch order.
 *
 * The model's own view. A refusal that never reached here would be a refusal
 * the model cannot act on, which is the failure mode a `runs` array alone
 * cannot see.
 * @param ctx - the mounted context holding the session.
 * @param id - the session to read.
 * @returns one string per tool result, ordered as the log holds them.
 */
function resultTexts(ctx: Context, id: SessionId): string[] {
  return ctx.sessions.get(id)!.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : [
    event.data.message.content.flatMap(block =>
      block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
  ])
}

describe('P2-12 must[2]: an emergency stop refuses the actions a run has not taken yet', () => {
  it('refuses the rest of a batch when the call before it raised the stop, and does not undo the one that ran', async () => {
    // The window the old reach missed entirely. `maxParallelToolCalls: 1`
    // sequences the batch so the second call's gate is asked AFTER the first
    // call's effect, which is what makes "mid-batch" a fact of this case
    // rather than a race: with the default of ten, both gates would be asked
    // before either tool ran and the case would pass for the wrong reason.
    const runs: string[] = []
    const ctx = await harness(
      new MockAdapter([
        calls([{ id: 'c1', name: 'charge', args: { amount: '10' } }, { id: 'c2', name: 'charge', args: { amount: '20' } }]),
        textResponse('done'),
      ]),
      { plane: true, maxParallelToolCalls: 1 },
    )
    ctx.tools.register(defineContentToolFixture({
      name: 'charge',
      description: 'an external effect',
      parameters: { amount: { type: 'string', required: true } },
      execute: (args: { amount: string }) => {
        runs.push(args.amount)
        // The operator hits stop while this call is running. Raised from
        // inside the tool because that is the only place in this file that is
        // provably between the two dispatches.
        ctx.controlPlane.control('pause-new-actions', REQUEST)
        return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
      },
    }))
    const session = SessionId('stop-mid-batch')
    const agent = await ctx.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    // The second charge never happened.
    expect(runs, 'a stop must refuse the action that had not started').toEqual(['10'])
    const texts = resultTexts(ctx, session)
    // And the first one is NOT undone: its result stands exactly as it was.
    // A stop that rolled back completed work would be a stop that cannot be
    // used, because an operator cannot know what it would erase.
    expect(texts[0]).toBe('charged 10')
    // The model is told, in order, and told WHY — an unexplained failure would
    // read as a broken tool and be retried.
    expect(texts[1]).toContain('emergency stop is in force')
    expect(texts[1]).toContain('charge')
  })

  it('dispatches normally when nothing mounts a control plane, because absence is not a stop', async () => {
    // The positive control the refusal above needs, and the one clause the
    // gate could most easily get wrong: `stopGateFor` answers `'no-channel'`
    // for a composition that mounts no plane, and a gate reading that as a
    // refusal would make every profile without the plane unable to run a tool.
    const runs: string[] = []
    const ctx = await harness(
      new MockAdapter([
        calls([{ id: 'c1', name: 'charge', args: { amount: '10' } }, { id: 'c2', name: 'charge', args: { amount: '20' } }]),
        textResponse('done'),
      ]),
      { maxParallelToolCalls: 1 },
    )
    ctx.tools.register(defineContentToolFixture({
      name: 'charge',
      description: 'an external effect',
      parameters: { amount: { type: 'string', required: true } },
      execute: (args: { amount: string }) => {
        runs.push(args.amount)
        return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
      },
    }))
    const session = SessionId('stop-absent')
    const agent = await ctx.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual(['10', '20'])
    expect(resultTexts(ctx, session)).toEqual(['charged 10', 'charged 20'])
  })

  it('lets the run act again once the stop is lifted, so the gate is a pause and not a kill', async () => {
    // acceptance[0] is about resuming as much as about stopping. A gate that
    // refused forever after one stop would pass the first case here and make
    // the control plane unusable, and nothing else in this file would notice.
    const runs: string[] = []
    const ctx = await harness(
      new MockAdapter([
        calls([{ id: 'c1', name: 'charge', args: { amount: '10' } }]),
        textResponse('paused'),
        calls([{ id: 'c2', name: 'charge', args: { amount: '20' } }]),
        textResponse('done'),
      ]),
      { plane: true },
    )
    ctx.tools.register(defineContentToolFixture({
      name: 'charge',
      description: 'an external effect',
      parameters: { amount: { type: 'string', required: true } },
      execute: (args: { amount: string }) => {
        runs.push(args.amount)
        return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
      },
    }))
    const session = SessionId('stop-then-resume')
    const agent = await ctx.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    ctx.controlPlane.control('pause-new-actions', REQUEST)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(runs, 'the stop was in force for this turn').toEqual([])

    ctx.controlPlane.control('resume', REQUEST)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs, 'a resumed run acts again').toEqual(['20'])
    const texts = resultTexts(ctx, session)
    expect(texts[0]).toContain('emergency stop is in force')
    expect(texts[1]).toBe('charged 20')
  })
})

describe('P2-12 must[2] / BLOCKED-265: the stop reaches inside a PTC program too', () => {
  it('refuses the sub-call after the stop, keeps the one already done, and ends the program saying why', async () => {
    // The gap BLOCKED-265 names. A PTC program issues its own dispatches
    // without returning to the model, so every guard the native path applies
    // per call must be applied per SUB-call — and the stop was applied to
    // neither. Both paths now reach one `refuseNewAction`, which is why this
    // case and the native one above cannot drift.
    const runs: string[] = []
    const outcomes: string[] = []
    const ctx = await harness(
      new MockAdapter([
        calls([{ id: 'c1', name: RUN_CODE_NAME, args: { code: 'program', description: 'charge twice' } }]),
        textResponse('done'),
      ]),
      { plane: true, ptc: true },
    )
    ctx.tools.register(defineContentToolFixture({
      name: 'charge',
      description: 'an external effect',
      parameters: { amount: { type: 'string', required: true } },
      execute: (args: { amount: string }) => {
        runs.push(args.amount)
        return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
      },
    }))
    const runtime = ctx.codeRuntime as FakeRuntime
    runtime.behavior = async (request) => {
      const tools = request.bindings[0]!.functions
      outcomes.push(`first:${JSON.stringify(await tools.charge!({ amount: '10' }))}`)
      // The operator hits stop while the program is between its two calls.
      ctx.controlPlane.control('pause-new-actions', REQUEST)
      try {
        await tools.charge!({ amount: '20' })
        outcomes.push('second:NOT REFUSED')
      } catch (error) {
        // A refused sub-call reaches the PROGRAM as a thrown binding error,
        // never as a returned value — the same contract the ledger refusal
        // has, and for the same reason: nothing ran, so there is no result.
        outcomes.push(`second:${String(error)}`)
      }
      try {
        await tools.charge!({ amount: '30' })
        outcomes.push('third:NOT REFUSED')
      } catch (error) {
        // And the program is over, not merely interrupted once: a run whose
        // next action was refused must not go on issuing more of them.
        outcomes.push(`third:${String(error)}`)
      }
      return { logs: [], value: 'program ended' }
    }
    const session = SessionId('stop-inside-ptc')
    const agent = await ctx.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    // Only the charge that preceded the stop happened, and it was not undone.
    expect(runs, 'a stop must refuse the sub-call that had not started').toEqual(['10'])
    expect(outcomes[0]).toContain('charged 10')
    expect(outcomes[1]).toContain('emergency stop is in force')
    expect(outcomes[2]).toContain('run is over')
  })

  it('runs a PTC program to the end when nothing mounts a control plane', async () => {
    // The positive control for the case above. Without it, a guard that
    // refused every sub-call unconditionally would pass it.
    const runs: string[] = []
    const ctx = await harness(
      new MockAdapter([
        calls([{ id: 'c1', name: RUN_CODE_NAME, args: { code: 'program', description: 'charge twice' } }]),
        textResponse('done'),
      ]),
      { ptc: true },
    )
    ctx.tools.register(defineContentToolFixture({
      name: 'charge',
      description: 'an external effect',
      parameters: { amount: { type: 'string', required: true } },
      execute: (args: { amount: string }) => {
        runs.push(args.amount)
        return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
      },
    }))
    const runtime = ctx.codeRuntime as FakeRuntime
    runtime.behavior = async (request) => {
      const tools = request.bindings[0]!.functions
      await tools.charge!({ amount: '10' })
      await tools.charge!({ amount: '20' })
      return { logs: [], value: 'program ended' }
    }
    const session = SessionId('ptc-stop-absent')
    const agent = await ctx.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual(['10', '20'])
  })
})

/**
 * Take this agent's work item away, the way a real second host would.
 *
 * The incumbent lease is read out of the store rather than assumed, and the
 * takeover clock is that lease's own `expiresAtMs + 1`: `acquire` refuses
 * `held-by-another` unless the incumbent is reclaimable AT the clock it is
 * given (`lease/src/store.ts:89-91`, `isReclaimable` at
 * `lease-contract/src/index.ts:73-75`), and this file's harness opens Runs with
 * `leaseMs: 30_000`. A hardcoded offset would silently fail to take the item
 * and leave the case passing for the wrong reason, so the acquisition is
 * asserted.
 * @param ctx - the mounted context holding the lease store.
 * @param agentId - the agent whose Run is being taken; it IS the work item
 *   (`run/src/index.ts:875`).
 */
function fenceOut(ctx: Context, agentId: string): void {
  const workItem = brandString<WorkItemId>(agentId)
  const incumbent = ctx.leaseStore.get(workItem)
  expect(incumbent, 'the Run Service must have taken a lease before this host can be fenced out of it').toBeDefined()
  const result = ctx.leaseStore.acquire(
    workItem,
    brandString<WorkerId>('a-different-host'),
    incumbent!.expiresAtMs + 1,
    1_000,
  )
  expect(result.acquired, `the takeover itself must succeed, or this case proves nothing: ${JSON.stringify(result)}`).toBe(true)
}

describe('P4-07 must[1] / BLOCKED-265: the fencing check reaches a call this run has already started making', () => {
  it('refuses the PTC sub-call issued after another host took the Run, and ends the program', async () => {
    // The observation BLOCKED-265 left owed. `refuseNewAction` carries the
    // fencing arm on both paths, but every case that drove it drove the STOP,
    // and P4-07's own frozen cases are on the native path or in the lease
    // store -- so the arm was reached by code and observed by nothing.
    const runs: string[] = []
    const outcomes: string[] = []
    const ctx = await harness(
      new MockAdapter([
        calls([{ id: 'c1', name: RUN_CODE_NAME, args: { code: 'program', description: 'charge twice' } }]),
        textResponse('done'),
      ]),
      { ptc: true },
    )
    ctx.tools.register(defineContentToolFixture({
      name: 'charge',
      description: 'an external effect',
      parameters: { amount: { type: 'string', required: true } },
      execute: (args: { amount: string }) => {
        runs.push(args.amount)
        return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
      },
    }))
    const session = SessionId('ptc-fenced-mid-program')
    const agent = await ctx.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    const runtime = ctx.codeRuntime as FakeRuntime
    runtime.behavior = async (request) => {
      const tools = request.bindings[0]!.functions
      outcomes.push(`first:${JSON.stringify(await tools.charge!({ amount: '10' }))}`)
      // The takeover happens BETWEEN two sub-calls, which is the whole
      // question: a host fenced before the step never starts the program at
      // all, because `run_code` is itself a tool call and the batch-level
      // check refuses it first.
      fenceOut(ctx, agent.id)
      try {
        await tools.charge!({ amount: '20' })
        outcomes.push('second:NOT REFUSED')
      } catch (error) {
        outcomes.push(`second:${String(error)}`)
      }
      try {
        await tools.charge!({ amount: '30' })
        outcomes.push('third:NOT REFUSED')
      } catch (error) {
        outcomes.push(`third:${String(error)}`)
      }
      return { logs: [], value: 'program ended' }
    }
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs, 'a fenced host must not perform the sub-call it had not started').toEqual(['10'])
    // The MID-BATCH fenced sentence, which is `refusedDispatchResult`'s and
    // NOT the batch-level one a pre-step fencing produces ("this run is no
    // longer the owner of its work item", `agent-loop/src/tool-calls.ts:472`).
    // Two sentences and two error names for one condition, separated only by
    // when the takeover lands -- recorded as BLOCKED-277, because unifying
    // them edits a string a frozen case asserts verbatim.
    expect(outcomes[1]).toContain('this host no longer holds its work item')
    expect(outcomes[2]).toContain('run is over')
  })

  it('runs the same program to the end while this host still holds its Run', async () => {
    // The positive control, and it is not the one above it in this file: that
    // one mounts no control plane, so it answers "absence does not refuse".
    // This one mounts everything and leaves the lease ALONE, so the only
    // difference from the case above is who owns the work item.
    const runs: string[] = []
    const ctx = await harness(
      new MockAdapter([
        calls([{ id: 'c1', name: RUN_CODE_NAME, args: { code: 'program', description: 'charge twice' } }]),
        textResponse('done'),
      ]),
      { ptc: true },
    )
    ctx.tools.register(defineContentToolFixture({
      name: 'charge',
      description: 'an external effect',
      parameters: { amount: { type: 'string', required: true } },
      execute: (args: { amount: string }) => {
        runs.push(args.amount)
        return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
      },
    }))
    const session = SessionId('ptc-lease-held')
    const agent = await ctx.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    const runtime = ctx.codeRuntime as FakeRuntime
    runtime.behavior = async (request) => {
      const tools = request.bindings[0]!.functions
      await tools.charge!({ amount: '10' })
      await tools.charge!({ amount: '20' })
      await tools.charge!({ amount: '30' })
      return { logs: [], value: 'program ended' }
    }
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs, 'an owned Run must execute every sub-call, or the refusal above is about the harness').toEqual(['10', '20', '30'])
    // Asserted on the very predicate the gate reads (`refuseNewAction` ->
    // `RunLease.mayWrite`, `lease-contract/src/run-lease.ts:52`), so the
    // control is decisive about the same input rather than about a proxy for
    // it. The store's `holder` is the Run Service's own worker id, not this
    // agent's, so reading the row would prove less and could read as proving
    // more.
    expect(agent.runLease?.mayWrite(Date.now()), 'the control must still own its work item').toBe(true)
  })

  it('refuses the rest of a NATIVE batch once the takeover lands mid-batch, with the same sentence', async () => {
    // The native half of the same arm, and the reason this case exists apart
    // from `fenced-dispatch.spec.ts`'s: that file fences the host BEFORE the
    // step, so it observes the batch-level check at
    // `agent-loop/src/tool-calls.ts:101`. Nothing observed the per-call check
    // at `:286`, which is the only one that can refuse a call in a batch the
    // host was still entitled to when the batch began.
    const runs: string[] = []
    const ctx = await harness(
      new MockAdapter([
        calls([
          { id: 'c1', name: 'charge', args: { amount: '10' } },
          { id: 'c2', name: 'charge', args: { amount: '20' } },
        ]),
        textResponse('done'),
      ]),
      // Sequenced, so "the call before it" is a real ordering and not a race.
      { maxParallelToolCalls: 1 },
    )
    const session = SessionId('native-fenced-mid-batch')
    const agent = await ctx.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'charge',
      description: 'an external effect',
      parameters: { amount: { type: 'string', required: true } },
      execute: (args: { amount: string }) => {
        runs.push(args.amount)
        // The takeover lands while the FIRST call of the batch is running, so
        // the second is dispatched by a host that no longer owns its Run.
        if (args.amount === '10') fenceOut(ctx, agent.id)
        return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
      },
    }))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs, 'the call already running is not undone; the one after it must not start').toEqual(['10'])
    const texts = resultTexts(ctx, session)
    expect(texts[0]).toContain('charged 10')
    expect(texts[1]).toContain('this host no longer holds its work item')
  })
})
