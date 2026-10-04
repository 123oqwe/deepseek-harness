/**
 * Epic P2-07 U2: what the model is told when it collects a detached run that
 * stopped to wait for an approval.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import * as toolWorkflow from '../src/index.ts'

/** What the run settled with: waiting for approval `approval-1`. */
const WAITING: WorkflowResult = { value: null, stopReason: 'waiting_for_approval', waitingFor: { approvalId: 'approval-1' }, agentsStarted: 1 }

/** An engine holding one detached run that settled waiting for approval `approval-1`. */
class WaitingEngine extends WorkflowEngine {
  start(request: WorkflowStartRequest): WorkflowRun {
    void request
    throw new Error('not under test')
  }

  resume(runId: WorkflowRunId, request: WorkflowStartRequest): Promise<WorkflowRun> {
    void runId
    void request
    throw new Error('not under test')
  }

  startDetached(request: WorkflowStartRequest): Promise<WorkflowRun> {
    void request
    throw new Error('not under test')
  }

  attach(runId: WorkflowRunId): WorkflowRun | undefined {
    return {
      id: runId,
      traceContext: undefined,
      meta: { name: 'ship', description: 'ships once approved' },
      result: Promise.resolve(WAITING),
      cancel: () => undefined,
      dispose: () => Promise.resolve(),
    }
  }
}

describe('P2-07 U2: collecting a run that waits for an approval', () => {
  it('reports the approval the run waits for, and that it resumes on its own', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WaitingEngine)
    await ctx.plugin(toolWorkflow, {})
    const session = Session.create(SessionId('caller'))
    const parent = { id: session.id, options: {}, session } as unknown as Agent

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-1'),
      name: 'workflow',
      arguments: { attach: 'run-1' },
      agent: parent,
    })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text)
      .toContain('workflow run is waiting for approval approval-1; it resumes on its own once the approval is decided')
  })
})
