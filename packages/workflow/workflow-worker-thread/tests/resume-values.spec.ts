/**
 * What a resumed run hands its script, what a refused resume tells its caller,
 * and in which order a finished child's log and its journal entry reach
 * storage (Epic P4-08 acceptance[0], acceptance[1]).
 *
 * Real worker runs over the composition `journal-live-run.spec.ts` builds, in
 * a file of their own because that file's case titles are frozen. The
 * cross-process kill of the same behavior is
 * `apps/cli/tests/profiles/acp/tests/workflow-resume.e2e.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies, TrackedContexts } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import { WorkflowExecution } from '../src/runtime.ts'
import type { ChildPort, ChildResult } from '../src/types.ts'

const contexts = new TrackedContexts()
const persistenceRoots: string[] = []
afterEach(async () => {
  // Disposed before their session directories are removed, so no write lands in a removed directory.
  await contexts.disposeAll()
  for (const root of persistenceRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A real worker engine whose children are in-process spawns, answered by
 * `MockAdapter` with `child <n>` in start order.
 * @param replies - how many children the case starts in total.
 * @param options - `persistence` mounts the JSONL session backend a resume reads child logs from.
 * @returns the context and the parent agent every run executes for.
 */
async function setup(replies: number, options: { persistence?: boolean } = {}) {
  const ctx = contexts.track(new Context())
  await mountAgentLoopTestDependencies(ctx)
  if (options.persistence === true) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-resume-values-'))
    persistenceRoots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root })
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(WorkerThreadWorkflowEngine, {})
  ctx.llm.registerAdapter(['mock'], new MockAdapter(
    Array.from({ length: replies }, (_, index) => textResponse(`child ${String(index)}`)),
  ))
  const parent = await ctx.agentLoop.create(SessionId('resume-values-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

const META = { name: 'resume-values', description: 'agent calls a resume continues', phases: [] }
const ONE_CHILD = "return await agent('only')"
const TWO_CHILDREN = "const a = await agent('first'); const b = await agent('second'); return [a, b]"

describe('P4-08 acceptance[0]: a finished child\'s log is durable before its step is journalled completed', () => {
  it('flushes each child session past its turn/end before the host journals the step completed', async () => {
    const { ctx, parent } = await setup(2)
    const flushedPastTurnEnd = new Set<string>()
    ctx.on('session/flush', async (session: Session) => {
      const coversTurnEnd = session.countEventsOfType('turn/end') > 0
      // A durability listener finishes after an await, as the JSONL backend's does.
      await Promise.resolve()
      if (coversTurnEnd) flushedPastTurnEnd.add(String(session.id))
    })
    // The host emits `workflow/agent-end` right after it journals the step (`host.ts` endAgent).
    const durableWhenJournalled: boolean[] = []
    ctx.on('workflow/agent-end', (_info, agent) => {
      if (agent.outcome === 'completed') durableWhenJournalled.push(flushedPastTurnEnd.has(String(agent.childId)))
    })

    const run = ctx.workflowEngine.start({ script: TWO_CHILDREN, meta: META, parent })
    expect((await run.result).stopReason).toBe('completed')
    await run.dispose()

    expect(durableWhenJournalled).toEqual([true, true])
  })

  it('logs a child flush that fails and still hands the child\'s result to the script', async () => {
    const { ctx, parent } = await setup(1)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    ctx.on('session/flush', () => { throw new Error('flush refused by the case') })

    const run = ctx.workflowEngine.start({ script: ONE_CHILD, meta: META, parent })
    const settled = await run.result
    await run.dispose()

    expect(settled).toMatchObject({ stopReason: 'completed', value: 'child 0' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('flush refused by the case'))
  })
})

describe('P4-08 acceptance[0]: a resumed run returns what its finished children returned', () => {
  it('hands the script the values the finished children returned, not a placeholder', async () => {
    const { ctx, parent } = await setup(2, { persistence: true })
    const first = ctx.workflowEngine.start({ script: TWO_CHILDREN, meta: META, parent })
    const firstSettled = await first.result
    await first.dispose()

    const resumed = await ctx.workflowEngine.resume(first.id, { script: TWO_CHILDREN, meta: META, parent })
    const settled = await resumed.result
    await resumed.dispose()

    expect(firstSettled.value).toEqual(['child 0', 'child 1'])
    expect(settled).toMatchObject({ stopReason: 'completed', agentsStarted: 0, value: ['child 0', 'child 1'] })
  })

  it('starts a step again when its journal kept only the placeholder, rather than failing the run', async () => {
    // Step 1 as a journal written before outputs were kept records it, step 2
    // as one written after.
    const started: string[] = []
    const fresh: ChildResult = { output: [{ type: 'text', text: 'fresh' }], stopReason: 'completed' }
    const children: ChildPort = {
      startAgent: (request) => {
        started.push(request.prompt)
        return Promise.resolve({ id: `child-${String(started.length)}`, result: Promise.resolve(fresh), dispose: () => Promise.resolve() })
      },
      startNested: () => Promise.reject(new Error('no nested runs in this case')),
    }
    const execution = new WorkflowExecution(
      META,
      "const a = await agent('one'); const b = await agent('two'); return [a, b]",
      undefined,
      { maxConcurrentAgents: 1, maxTotalAgents: 5, maxItemsPerCall: 10, syncTimeoutMs: 5_000 },
      { phase: () => {}, log: () => {}, agentStart: () => {}, agentEnd: () => {} },
      children,
      { 1: 'agent-result-1', 2: JSON.stringify('kept') },
    )

    const settled = await execution.drive()

    expect(started).toEqual(['one'])
    expect(settled).toMatchObject({ stopReason: 'completed', agentsStarted: 1, value: ['fresh', 'kept'] })
  })
})

describe('P4-08 acceptance[1]: a resume refused for a changed script says so', () => {
  it('names the refusal on the run it returns, and runs the changed script from the start under the same id', async () => {
    const { ctx, parent } = await setup(2, { persistence: true })
    const first = ctx.workflowEngine.start({ script: ONE_CHILD, meta: META, parent })
    await first.result
    await first.dispose()

    const resumed = await ctx.workflowEngine.resume(first.id, { script: `${ONE_CHILD} // changed`, meta: META, parent })
    const settled = await resumed.result
    await resumed.dispose()

    expect((resumed as WorkflowRun & { readonly resumeRefused?: unknown }).resumeRefused)
      .toMatchObject({ reason: 'script-digest-changed' })
    expect(resumed.id).toBe(first.id)
    expect(settled).toMatchObject({ stopReason: 'completed', agentsStarted: 1, value: 'child 1' })
  })
})
