/**
 * The workflow journal recorded by a REAL run (Epic P4-08 must[0], must[4]).
 *
 * Separate from `journal-host.spec.ts`, which is about the ADAPTER — the event
 * shapes `WorkerRun` receives, mapped to journal entries, with no worker
 * running. These cases start real worker threads and read the journal the host
 * actually kept. Splitting them is not tidiness: P4-08.U's freeze replays
 * `journal-host.spec.ts` by name and expects those eight titles, and an earlier
 * draft of this file OVERWROTE it, deleting frozen cases in the same commit
 * that added new ones.
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
import { afterEach, describe, expect, it } from 'vitest'
import { readJournal } from '@deepseek-ai/dsh-workflow-journal'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import type { WorkerRun } from '../src/host.ts'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'

const persistenceRoots: string[] = []
afterEach(() => { for (const root of persistenceRoots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function setup(replies: number, options: { persistence?: boolean } = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  if (options.persistence === true) {
    // A resume reconciles against the child's DURABLE log, so the composition
    // that proves acceptance[0] needs one; without persistence the check falls
    // back to the live registry, which a settled run has already emptied.
    const root = mkdtempSync(join(tmpdir(), 'dsh-journal-sessions-'))
    persistenceRoots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root })
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
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

  it('RESUMES without starting the completed children again (acceptance[0])', async () => {
    // Counted where the journal cannot fake it: every `workflow/agent-start`
    // the host emits is one child actually started, and a reused step emits
    // none by construction. Asking the journal whether it skipped would prove
    // only that it recorded a skip.
    //
    // The kill is the discarded host: the resumed run reads the file the first
    // one wrote and holds none of its memory.
    const { ctx, parent } = await setup(4, { persistence: true })
    const started: number[] = []
    ctx.on('workflow/agent-start', () => { started.push(1) })

    const body = "const a = await agent('first'); const b = await agent('second'); return [a, b]"
    const first = ctx.workflowEngine.start({ script: body, meta: META, parent }) as WorkerRun
    await first.result
    await first.dispose()
    expect(started).toHaveLength(2)

    const resumed = await ctx.workflowEngine.resume(first.id, { script: body, meta: META, parent })
    const settled = await resumed.result

    // Both steps reconciled against their children's durable sessions, so the
    // resumed run started NO further children and still produced both results.
    expect(started).toHaveLength(2)
    expect(settled.stopReason).toBe('completed')
    expect(settled.agentsStarted).toBe(0)
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

describe('P4-08 acceptance[2]: a settled run persists a journal that keeps its evidence', () => {
  it('CONTINUES the journal it resumed from instead of overwriting it', async () => {
    // The defect this pins: a resumed run used to build a fresh recorder, so
    // its first persist replaced the file and the steps the resume had just
    // reconciled vanished. A second crash would then re-run them — the journal
    // forgetting exactly the work it exists to remember.
    const { ctx, parent } = await setup(2, { persistence: true })
    const body = "const a = await agent('first'); const b = await agent('second'); return [a, b]"
    const first = ctx.workflowEngine.start({ script: body, meta: META, parent }) as WorkerRun
    await first.result
    await first.dispose()

    const resumed = await ctx.workflowEngine.resume(first.id, { script: body, meta: META, parent })
    await resumed.result

    const persisted = readJournal(first.journalRoot, first.id)
    expect(persisted?.entries.map(entry => entry.stepId)).toEqual(['step-1', 'step-2'])
  })

  it('marks a RECONCILED step verified, which is what compaction acts on', async () => {
    // `verified` had no production producer at all: the flag compaction and
    // must[1] both read was set only by tests. Reconciliation is the check
    // that earns it — the ledger confirmed the effects and every child was
    // accounted for, which is more than re-reading the step's own record.
    const { ctx, parent } = await setup(2, { persistence: true })
    const body = "const a = await agent('first'); const b = await agent('second'); return [a, b]"
    const first = ctx.workflowEngine.start({ script: body, meta: META, parent }) as WorkerRun
    await first.result
    await first.dispose()

    const resumed = await ctx.workflowEngine.resume(first.id, { script: body, meta: META, parent })
    await resumed.result

    const persisted = readJournal(first.journalRoot, first.id)
    expect(persisted?.entries.every(entry => entry.verified)).toBe(true)
    // Every receipt survives the compaction the settlement performed, which is
    // the half of acceptance[2] that is a safety property rather than a saving.
    expect(persisted?.entries.flatMap(entry => entry.childReceipts)).toHaveLength(2)
  })
})

describe('P4-09 §12.66: a LIVE run may not be resumed, and the guard runs before the work', () => {
  it('refuses a resume while the run still holds its lease, naming the holder', async () => {
    // Without this, `resume` re-enters a run another holder is executing and
    // the re-attach path spawns a second worker under one run id — two masters
    // inside the epic meant to prevent them.
    const { ctx, parent } = await setup(2, { persistence: true })
    const live = ctx.workflowEngine.start({
      script: "await new Promise(resolve => setTimeout(resolve, 300)); return 'done'",
      meta: META,
      parent,
    }) as WorkerRun

    await expect(ctx.workflowEngine.resume(live.id, { script: "return 'x'", meta: META, parent }))
      .rejects.toThrow(/is held by .+ and is still live; resume refused/u)

    await live.result
    await live.dispose()
  })

  it('refuses BEFORE reconciling, so a live run\'s journal is never read', async () => {
    // The ORDER is the property, not the refusal. Reconciliation reads a
    // journal its holder is actively writing and then discards the answer; a
    // guard placed after the work it guards is not a guard.
    //
    // Observed without mocking, by making the two orders fail differently:
    // `readJournal` THROWS on a file that exists and does not parse, and
    // returns `undefined` only for one that is absent. So a resume that
    // reconciles first surfaces the parse error, and one that takes the lease
    // first never opens the file and surfaces the refusal. The assertion is on
    // WHICH error arrives, which no ordering can satisfy vacuously.
    const { ctx, parent } = await setup(2, { persistence: true })
    const live = ctx.workflowEngine.start({
      script: "await new Promise(resolve => setTimeout(resolve, 300)); return 'done'",
      meta: META,
      parent,
    }) as WorkerRun

    const engine = ctx.workflowEngine as unknown as { journalDirectory: string }
    writeFileSync(join(engine.journalDirectory, `${live.id}.json`), '{ not json', 'utf8')

    await expect(ctx.workflowEngine.resume(live.id, { script: "return 'x'", meta: META, parent }))
      .rejects.toThrow(/resume refused/u)

    await live.result
    await live.dispose()
  })
})
