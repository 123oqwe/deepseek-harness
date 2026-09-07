/**
 * The workflow journal recorded by a REAL run (Epic P4-08 must[0], must[4]).
 *
 * **The journal had no producer.** Its entries, its resume decisions and its
 * compaction all shipped with, measured, no host writing to it: `must[4]`'s
 * "the worker API must be journalable" held over an adapter nothing attached.
 * These cases run scripts through the real worker thread and read the journal
 * the host actually kept.
 *
 * The entry is written when a step STARTS, which is the property a crash
 * depends on: a run killed mid-step must leave an `in-flight` entry rather
 * than no trace, because "never began" and "began and its effect escaped" are
 * the two cases a resume has to tell apart.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import type { WorkerRun } from '../src/host.ts'

async function setup(replies: number) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(WorkerThreadWorkflowEngine, {})
  // One RESPONSE per child, not one flattened chunk stream: `MockAdapter`
  // takes a list of responses and hands out one per request. Flattening them
  // made every child receive the same exhausted stream and return `null`, and
  // the journal correctly recorded two FAILED steps — the first version of
  // this file asserted `completed` and was wrong about its own fixture.
  ctx.llm.registerAdapter(['mock'], new MockAdapter(
    Array.from({ length: replies }, (_, index) => textResponse(`child ${String(index)}`)),
  ))
  const parent = ctx.agentLoop.create(SessionId('journal-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

const META = { name: 'journalled', description: 'one agent call', phases: [] }

describe('P4-08 must[0]: a real run keeps a journal', () => {
  it('records one entry per agent() call, keyed to the script digest', async () => {
    const { ctx, parent } = await setup(2)
    const body = "const a = await agent('first'); const b = await agent('second'); return [a, b]"
    const run = ctx.workflowEngine.start({ script: body, meta: META, parent }) as WorkerRun
    await run.result

    const journal = run.journalSnapshot()
    expect(journal.entries).toHaveLength(2)
    expect(journal.entries.map(entry => entry.stepId)).toEqual(['step-1', 'step-2'])
    expect(journal.entries.every(entry => entry.outcome === 'completed')).toBe(true)
    // The digest is over the SCRIPT, which is what `admitResume` compares: a
    // journal that named the run instead could never refuse a resume of a
    // changed script (acceptance[1]).
    expect(journal.scriptDigest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('gives two DIFFERENT scripts different digests, so a resume cannot cross them', async () => {
    // The control acceptance[1] needs. Without it the digest could be a
    // constant and the case above would still pass.
    const first = await setup(1)
    const runA = first.ctx.workflowEngine.start({
      script: "return await agent('a')", meta: META, parent: first.parent,
    }) as WorkerRun
    await runA.result

    const second = await setup(1)
    const runB = second.ctx.workflowEngine.start({
      script: "return await agent('b')", meta: META, parent: second.parent,
    }) as WorkerRun
    await runB.result

    expect(runA.journalSnapshot().scriptDigest).not.toBe(runB.journalSnapshot().scriptDigest)
  })

  it('classes every agent() step SIDE-EFFECTING, so a resume reconciles rather than skips', async () => {
    // must[2]. The DSL has no syntax for a script to declare a step pure, and
    // an observer cannot see whether an effect escaped, so the default is the
    // one that forces reconciliation. A `pure` default would let a resume skip
    // a step that had already spent money.
    const { ctx, parent } = await setup(1)
    const run = ctx.workflowEngine.start({
      script: "return await agent('only')", meta: META, parent,
    }) as WorkerRun
    await run.result

    expect(run.journalSnapshot().entries.map(entry => entry.effectClass)).toEqual(['side-effecting'])
  })
})
