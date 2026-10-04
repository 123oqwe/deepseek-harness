/**
 * Epic P2-07 U2 on a real engine: a detached workflow run waits durably for an
 * approval (must[2]) and is woken once it is decided (must[3]), in the same
 * process or, after a restart, by the scan at mount (acceptance[0]).
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type {
  ApprovalRequestId, ApprovalViewer, PrincipalId, RunId, SessionId as ApprovalSessionId, TenantId,
} from '@deepseek-ai/dsh-approval-store'
import ApprovalStoreSqlitePlugin, { openApprovalStore } from '@deepseek-ai/dsh-approval-store/sqlite'
import { brandString } from '@deepseek-ai/dsh-brand'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import { acquireRunLease, type WorkerId, type WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { WorkflowResultInfo, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { readJournal, writeJournal, type ScriptDigest } from '@deepseek-ai/dsh-workflow-journal'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import { WorkerToHostType, type WorkerToHostMessage } from '../src/protocol.ts'

interface Dirs { readonly home: string; readonly sessions: string; readonly approvals: string }

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/** One home, session root and approval store, shared by every composition of a case. */
function dirs(): Dirs {
  const root = mkdtempSync(join(tmpdir(), 'dsh-workflow-approval-wait-'))
  roots.push(root)
  return { home: join(root, 'home'), sessions: join(root, 'sessions'), approvals: join(root, 'approvals') }
}

/**
 * A composition over `at`: session persistence, the engine, and the approval store unless `store` is false.
 * @param at - the shared directories.
 * @param options - `store: false` mounts no approval store; `beforeEngine` runs before the engine mounts.
 * @returns the context and a launcher agent.
 */
async function compose(at: Dirs, options: { store?: boolean; beforeEngine?: (ctx: Context) => void } = {}) {
  vi.stubEnv('DSH_HOME', at.home)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  // Before the engine: its scan at mount may wake a run whose agent uses this route.
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('before'), textResponse('after')]))
  await ctx.plugin(JsonlSessionPersistence, { root: at.sessions })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  if (options.store !== false) await ctx.plugin(ApprovalStoreSqlitePlugin, { directory: at.approvals, busyTimeoutMs: 1000 })
  options.beforeEngine?.(ctx)
  await ctx.plugin(WorkerThreadWorkflowEngine, {})
  const launcher = await ctx.agentLoop.create(SessionId(`launcher-${randomUUID()}`), { provider: 'mock', model: 'mock' })
  return { ctx, launcher }
}

/**
 * End a composition, as its process ending would.
 * @param ctx - the composition.
 */
async function end(ctx: Context): Promise<void> {
  contexts.splice(contexts.indexOf(ctx), 1)
  await ctx.fiber.dispose()
}

/**
 * The next `workflow/end` of `runId` that is not a wait.
 * @param ctx - the composition.
 * @param runId - the run.
 * @returns its settled outcome.
 */
function finished(ctx: Context, runId: WorkflowRunId): Promise<WorkflowResultInfo> {
  return new Promise((resolve) => {
    ctx.on('workflow/end', (info, result) => {
      if (info.id === runId && result.stopReason !== 'waiting_for_approval') resolve(result)
    })
  })
}

const META = { name: 'ship', description: 'ships once approved', phases: [] }
const SCRIPT = "await agent('prepare'); await approval({ title: 'ship it' }); return 'shipped'"
const operator: ApprovalViewer = { tenant: brandString<TenantId>('local'), principal: brandString<PrincipalId>('operator') }

describe('P2-07 must[2]: a workflow run waits for an approval', () => {
  it('refuses approval() in a run the launching turn owns, which no scheduler can wake', async () => {
    const { ctx, launcher } = await compose(dirs())
    const run = ctx.workflowEngine.start({ script: "await approval({ title: 'ship it' }); return 'shipped'", meta: META, parent: launcher })
    expect(await run.result).toMatchObject({ stopReason: 'error', error: expect.stringContaining('needs a detached run') as string })
    await run.dispose()
  }, 30_000)

  it('refuses approval() where no approval store is mounted', async () => {
    const { ctx, launcher } = await compose(dirs(), { store: false })
    const run = await ctx.workflowEngine.startDetached({ script: "await approval({ title: 'ship it' }); return 'shipped'", meta: META, parent: launcher })
    expect(await run.result).toMatchObject({ stopReason: 'error', error: expect.stringContaining('needs an approval store') as string })
  }, 30_000)

  it('settles waiting_for_approval, with a run-scoped approval pending and the wait journaled', async () => {
    const at = dirs()
    const { ctx, launcher } = await compose(at)
    const run = await ctx.workflowEngine.startDetached({ script: SCRIPT, meta: META, parent: launcher })
    const settled = await run.result
    expect(settled).toMatchObject({ stopReason: 'waiting_for_approval', value: null })
    const approvalId = settled.waitingFor?.approvalId
    const pending = ctx.get('approvalStore')?.listPending(operator, Date.now()) ?? []
    expect(pending.map(row => [row.id, row.scope.kind, row.toolName])).toEqual([[approvalId, 'run', 'workflow ship: ship it']])
    const journal = readJournal(join(at.home, 'journals'), run.id)
    expect(journal?.approvals).toMatchObject([{ approvalId, state: 'waiting' }])
    expect(journal?.start).toMatchObject({ script: SCRIPT, route: { provider: 'mock', model: 'mock' } })
  }, 30_000)
})

describe('P2-07 must[3]: a decided approval wakes the run', () => {
  it('continues the run past the call once another client approves, consuming the approval', async () => {
    const { ctx, launcher } = await compose(dirs())
    const run = await ctx.workflowEngine.startDetached({ script: SCRIPT, meta: META, parent: launcher })
    const approvalId = brandString<ApprovalRequestId>(String((await run.result).waitingFor?.approvalId))
    const done = finished(ctx, run.id)
    const store = ctx.get('approvalStore')
    store?.decide(approvalId, 0, 'approved', operator, Date.now())

    expect(await done).toMatchObject({ stopReason: 'completed' })
    expect((await ctx.workflowEngine.attach(run.id)?.result)?.value).toBe('shipped')
    expect(store?.get(approvalId, operator, Date.now())?.state).toBe('consumed')
  }, 30_000)

  it('lets the script catch the refusal of a denied approval', async () => {
    const { ctx, launcher } = await compose(dirs())
    const run = await ctx.workflowEngine.startDetached({
      script: "try { await approval({ title: 'ship it' }); return 'shipped' } catch (error) { return error.name + ':' + error.refusal }",
      meta: META,
      parent: launcher,
    })
    const approvalId = brandString<ApprovalRequestId>(String((await run.result).waitingFor?.approvalId))
    const done = finished(ctx, run.id)
    ctx.get('approvalStore')?.decide(approvalId, 0, 'denied', operator, Date.now())

    expect(await done).toMatchObject({ stopReason: 'completed' })
    expect((await ctx.workflowEngine.attach(run.id)?.result)?.value).toBe('ApprovalRefusedError:denied')
  }, 30_000)

  it('wakes, in a process that starts after the approval was decided, the run another process left waiting (acceptance[0])', async () => {
    const at = dirs()
    const first = await compose(at)
    const run = await first.ctx.workflowEngine.startDetached({ script: SCRIPT, meta: META, parent: first.launcher })
    const approvalId = brandString<ApprovalRequestId>(String((await run.result).waitingFor?.approvalId))
    await end(first.ctx)
    const decider = openApprovalStore(at.approvals, { busyTimeoutMs: 1000 })
    decider.decide(approvalId, 0, 'approved', operator, Date.now())

    let done: Promise<WorkflowResultInfo> | undefined
    const second = await compose(at, { beforeEngine: (ctx) => { done = finished(ctx, run.id) } })
    expect(await done).toMatchObject({ stopReason: 'completed' })
    expect((await second.ctx.workflowEngine.attach(run.id)?.result)?.value).toBe('shipped')
    expect(decider.get(approvalId, operator, Date.now())?.state).toBe('consumed')
    decider.close()
  }, 60_000)
})

describe('P2-07 must[3]: what wakes a waiting run, and what does not', () => {
  it('keeps a run waiting across a restart while its approval is undecided, and wakes it on a decision made after', async () => {
    const at = dirs()
    const first = await compose(at)
    const run = await first.ctx.workflowEngine.startDetached({ script: SCRIPT, meta: META, parent: first.launcher })
    const approvalId = brandString<ApprovalRequestId>(String((await run.result).waitingFor?.approvalId))
    await end(first.ctx)

    const { ctx } = await compose(at)
    const store = ctx.get('approvalStore')
    expect(store?.get(approvalId, operator, Date.now())?.state).toBe('requested')
    const done = finished(ctx, run.id)
    store?.decide(approvalId, 0, 'approved', operator, Date.now())

    expect(await done).toMatchObject({ stopReason: 'completed' })
    expect((await ctx.workflowEngine.attach(run.id)?.result)?.value).toBe('shipped')
  }, 60_000)

  it('scans past a journal it cannot read and one waiting on nothing, and the woken run keeps what it was started with', async () => {
    const at = dirs()
    const first = await compose(at)
    const run = await first.ctx.workflowEngine.startDetached({
      script: "await agent('prepare'); await approval({ title: 'ship it' }); return 'shipped ' + args.what",
      meta: META,
      args: { what: 'v1' },
      subagentProvider: 'spawn',
      maxTotalAgents: 5,
      parent: first.launcher,
    })
    const approvalId = brandString<ApprovalRequestId>(String((await run.result).waitingFor?.approvalId))
    await end(first.ctx)
    const journals = join(at.home, 'journals')
    writeJournal(journals, 'waiting-on-nothing', { scriptDigest: brandString<ScriptDigest>('another script'), entries: [] })
    writeFileSync(join(journals, 'unreadable.json'), '{')
    const decider = openApprovalStore(at.approvals, { busyTimeoutMs: 1000 })
    decider.decide(approvalId, 0, 'approved', operator, Date.now())
    decider.close()

    let done: Promise<WorkflowResultInfo> | undefined
    const warnings: string[] = []
    const second = await compose(at, {
      beforeEngine: (ctx) => {
        vi.spyOn(ctx.logger, 'warn').mockImplementation((...args: unknown[]) => {
          warnings.push(String(args[0]))
          return ctx.logger
        })
        done = finished(ctx, run.id)
      },
    })

    expect(await done).toMatchObject({ stopReason: 'completed' })
    expect((await second.ctx.workflowEngine.attach(run.id)?.result)?.value).toBe('shipped v1')
    expect(warnings.filter(warning => /journal of run unreadable is unreadable/u.test(warning))).toHaveLength(1)
  }, 60_000)

  it('starts nothing for a decided run-scoped approval that no waiting run journaled', async () => {
    const { ctx } = await compose(dirs())
    const started: string[] = []
    ctx.on('workflow/start', (info) => { started.push(info.id) })
    const store = ctx.get('approvalStore')
    const id = brandString<ApprovalRequestId>('not-a-workflow-approval')
    store?.request({
      id,
      tenant: operator.tenant,
      actor: operator.principal,
      scope: { kind: 'run', runId: brandString<RunId>('no-such-run'), sessionId: brandString<ApprovalSessionId>('no-such-session') },
      toolName: 'something else',
      requestDigest: 'sha256:something-else',
      deadlineMs: Date.now() + 60_000,
    }, Date.now())
    store?.decide(id, 0, 'approved', operator, Date.now())

    expect(started).toEqual([])
    expect(store?.get(id, operator, Date.now())?.state).toBe('approved')
  }, 30_000)

  it('leaves the approval unconsumed, and gives the run\'s session back, when another host holds the run', async () => {
    const at = dirs()
    const { ctx, launcher } = await compose(at)
    const run = await ctx.workflowEngine.startDetached({ script: SCRIPT, meta: META, parent: launcher })
    const approvalId = brandString<ApprovalRequestId>(String((await run.result).waitingFor?.approvalId))
    const session = SessionId(String(readJournal(join(at.home, 'journals'), run.id)?.start?.session))
    // The run gives its lease back once it settles waiting; another host then takes it.
    await vi.waitFor(() => {
      const taken = acquireRunLease(ctx.leaseStore, brandString<WorkItemId>(run.id), brandString<WorkerId>('another-host'), Date.now(), 60_000)
      expect('lease' in taken).toBe(true)
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    ctx.get('approvalStore')?.decide(approvalId, 0, 'approved', operator, Date.now())

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/waiting on approval \S+ was not resumed: .*held by another-host/u))
    })
    expect(ctx.get('approvalStore')?.get(approvalId, operator, Date.now())?.state).toBe('approved')
    expect(ctx.agents.get(session)).toBeUndefined()
  }, 30_000)

  it('ignores an approval() call that reaches the host after the run was cancelled, recording no approval', async () => {
    const { ctx, launcher } = await compose(dirs())
    const run = await ctx.workflowEngine.startDetached({ script: 'await new Promise(() => {})', meta: META, parent: launcher })
    const internals = run as unknown as { onMessage(message: WorkerToHostMessage): void; worker: { postMessage(message: unknown): void } }
    const posted = vi.spyOn(internals.worker, 'postMessage')
    run.cancel('stopped')

    internals.onMessage({ type: WorkerToHostType.ApprovalRequest, callId: 1, key: 'late:1', title: 'late' })

    expect(posted.mock.calls.map(([message]) => (message as { type: string }).type).filter(type => type.startsWith('approval-'))).toEqual([])
    expect(ctx.get('approvalStore')?.listPending(operator, Date.now())).toEqual([])
    expect((await run.result).stopReason).toBe('cancelled')
  }, 30_000)
})
