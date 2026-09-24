/**
 * The `workflow` tool's `resume` parameter (Epic P4-08 acceptance[0],
 * acceptance[1]): the shipped caller that continues an interrupted run by its
 * id, and what the model reads back when the resume is refused.
 *
 * In a file of its own because `tool-workflow.spec.ts`'s case titles are
 * frozen.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type {
  WorkflowResult, WorkflowRun, WorkflowRunId as WorkflowRunIdType, WorkflowStartRequest,
} from '@deepseek-ai/dsh-workflow'
import * as toolWorkflow from '../src/index.ts'

/** An interrupted run's id, in the form the worker-thread engine mints. */
const RUN_ID = '6f0e2c1a-8d4b-4c3e-9a7f-2b5d1e0c9f84'
const SCRIPT = 'return 1'
const META = { name: 'audit', description: 'd' }
const COMPLETED: WorkflowResult = { value: ['kept', 'fresh'], stopReason: 'completed', agentsStarted: 1 }

/** A refusal as an engine reports one for a changed script. */
interface Refusal {
  readonly reason: string
  readonly detail: string
}

/**
 * A run that has already completed, carrying a resume refusal when the engine reported one.
 * @param id - the run's id.
 * @param request - the request the run was started or resumed with.
 * @param refusal - why the resume did not continue the journal, if it did not.
 * @returns the settled run.
 */
function settledRun(id: WorkflowRunIdType, request: WorkflowStartRequest, refusal: Refusal | undefined): WorkflowRun {
  const run: WorkflowRun = {
    id,
    traceContext: request.traceContext,
    meta: request.meta,
    result: Promise.resolve(COMPLETED),
    cancel: () => {},
    dispose: () => Promise.resolve(),
  }
  return refusal === undefined ? run : Object.assign(run, { resumeRefused: refusal })
}

/** An engine behind `ctx.workflowEngine` whose runs settle at once, recording which entry point each call reached. */
class RecordingEngine extends WorkflowEngine {
  readonly started: WorkflowStartRequest[] = []
  readonly resumed: { readonly runId: WorkflowRunIdType; readonly request: WorkflowStartRequest }[] = []
  readonly detached: WorkflowStartRequest[] = []
  refusal: Refusal | undefined

  start(request: WorkflowStartRequest): WorkflowRun {
    this.started.push(request)
    return settledRun(WorkflowRunId(`run-${String(this.started.length)}`), request, undefined)
  }

  resume(runId: WorkflowRunIdType, request: WorkflowStartRequest): Promise<WorkflowRun> {
    this.resumed.push({ runId, request })
    return Promise.resolve(settledRun(runId, request, this.refusal))
  }

  startDetached(request: WorkflowStartRequest): Promise<WorkflowRun> {
    this.detached.push(request)
    return Promise.resolve(settledRun(WorkflowRunId('detached-1'), request, undefined))
  }

  attach(runId: WorkflowRunIdType): WorkflowRun | undefined {
    void runId
    return undefined
  }
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(RecordingEngine)
  await ctx.plugin(toolWorkflow, {})
  const engine = ctx.workflowEngine as RecordingEngine
  const session = Session.create(SessionId('caller'))
  const parent = { id: session.id, options: {}, session } as unknown as Agent
  return { ctx, engine, parent }
}

function execute(ctx: Context, parent: Agent, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('call-1'),
    name: 'workflow',
    arguments: args,
    agent: parent,
  })
}

function textOf(content: readonly ContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

describe('P4-08 acceptance[0]: the workflow tool resumes an interrupted run by its id', () => {
  it('asks the engine to resume that id with the call\'s script, meta and parent, and reports the id back', async () => {
    const { ctx, engine, parent } = await setup()

    const result = await execute(ctx, parent, { resume: RUN_ID, script: SCRIPT, meta: META })

    expect(engine.resumed.map(call => call.runId)).toEqual([RUN_ID])
    expect(engine.resumed[0]?.request).toMatchObject({ script: SCRIPT, meta: META, parent })
    expect(engine.started).toHaveLength(0)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected the resumed run to complete')
    expect(result.value).toEqual({ runId: RUN_ID, agentsStarted: 1, result: ['kept', 'fresh'] })
  })

  it('refuses `resume` together with `detached` before any run starts', async () => {
    const { ctx, engine, parent } = await setup()

    const result = await execute(ctx, parent, { resume: RUN_ID, detached: true, script: SCRIPT, meta: META })

    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('`resume` continues a run in the foreground')
    expect([engine.started.length, engine.resumed.length, engine.detached.length]).toEqual([0, 0, 0])
  })

  it('refuses a `resume` value that is not a run id before the engine is asked', async () => {
    // The id names the run's journal file and its lease row, so a path is not one.
    const { ctx, engine, parent } = await setup()

    const result = await execute(ctx, parent, { resume: '../escaped', script: SCRIPT, meta: META })

    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('`resume` must be a runId')
    expect([engine.started.length, engine.resumed.length]).toEqual([0, 0])
  })
})

describe('P4-08 acceptance[1]: a refused resume is visible to the model that asked for it', () => {
  it('completes the call, carries the refusal in its value, and names it in the text the model reads', async () => {
    const { ctx, engine, parent } = await setup()
    engine.refusal = { reason: 'script-digest-changed', detail: 'journal aaa vs script bbb' }

    const result = await execute(ctx, parent, { resume: RUN_ID, script: SCRIPT, meta: META })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected a refused resume to complete as a fresh run')
    expect(result.value).toEqual({
      runId: RUN_ID,
      agentsStarted: 1,
      result: ['kept', 'fresh'],
      resumeRefused: { reason: 'script-digest-changed', detail: 'journal aaa vs script bbb' },
    })
    expect(textOf(result.content)).toMatch(/^resume refused \(script-digest-changed\)/u)
  })
})
