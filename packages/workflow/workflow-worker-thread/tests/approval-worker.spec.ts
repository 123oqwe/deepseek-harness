/**
 * Epic P2-07 U2, worker side: what a script's `approval()` asks the host and
 * what each answer does to the script. The session runs in-process over a
 * MessageChannel, because code inside a real Worker is invisible to
 * main-process coverage.
 */
import { createHash } from 'node:crypto'
import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import type { WorkflowResult } from '@deepseek-ai/dsh-workflow'
import { HostToWorkerType, WorkerToHostType } from '../src/protocol.ts'
import type { HostToWorkerMessage, WorkerToHostMessage } from '../src/protocol.ts'
import { WorkflowExecution } from '../src/runtime.ts'
import { runWorkerSession } from '../src/session.ts'
import type { ApprovalWaitRequest, ChildPort, WorkerLimits } from '../src/types.ts'

const META = { name: 'ship', description: 'ships once approved' }
const LIMITS: WorkerLimits = { maxConcurrentAgents: 1, maxTotalAgents: 5, maxItemsPerCall: 10, syncTimeoutMs: 5_000 }

/** The host's answer to one approval request, given its callId. */
type Answer = (callId: number) => HostToWorkerMessage

/**
 * Run `body` in a worker session, answering its approval requests in order.
 * @param body - the script body.
 * @param answers - one answer per approval request the script makes.
 * @returns what the script asked and how the run settled.
 */
async function run(body: string, answers: readonly Answer[]): Promise<{ asked: ApprovalWaitRequest[]; result: WorkflowResult }> {
  const channel = new MessageChannel()
  const asked: ApprovalWaitRequest[] = []
  const settled = Promise.withResolvers<WorkflowResult>()
  channel.port1.on('message', (message: WorkerToHostMessage) => {
    if (message.type === WorkerToHostType.Ready) channel.port1.postMessage({ type: HostToWorkerType.Go } satisfies HostToWorkerMessage)
    if (message.type === WorkerToHostType.ApprovalRequest) {
      asked.push({ key: message.key, title: message.title })
      const answer = answers[asked.length - 1]
      if (answer !== undefined) channel.port1.postMessage(answer(message.callId))
    }
    if (message.type === WorkerToHostType.Result) settled.resolve(message.result)
  })
  const session = runWorkerSession(channel.port2, { meta: META, body, limits: LIMITS })
  const result = await settled.promise
  await session
  channel.port1.close()
  return { asked, result }
}

const granted: Answer = callId => ({ type: HostToWorkerType.ApprovalGranted, callId })

describe('P2-07 U2: a script\'s approval() on the worker side', () => {
  it('asks once per call, keyed by a digest of the title and how often it was asked, and continues on a grant', async () => {
    const { asked, result } = await run("await approval({ title: 'ship it' }); await approval({ title: 'ship it' }); return 'shipped'", [granted, granted])
    const digest = createHash('sha256').update('ship it').digest('hex')
    expect(asked).toEqual([{ key: `${digest}:1`, title: 'ship it' }, { key: `${digest}:2`, title: 'ship it' }])
    expect(result).toMatchObject({ stopReason: 'completed', value: 'shipped' })
  })

  it('throws an ApprovalRefusedError the script can catch, naming the approval and how it ended', async () => {
    const { result } = await run(
      "try { await approval({ title: 'ship it' }); return 'shipped' } catch (error) { return [error.name, error.code, error.approvalId, error.refusal] }",
      [callId => ({ type: HostToWorkerType.ApprovalRefused, callId, approvalId: 'approval-1', refusal: 'denied' })],
    )
    expect(result).toMatchObject({ stopReason: 'completed', value: ['ApprovalRefusedError', 'APPROVAL_REFUSED', 'approval-1', 'denied'] })
  })

  it('fails the run with the host\'s reason when the run cannot wait', async () => {
    const { result } = await run(
      "await approval({ title: 'ship it' }); return 'shipped'",
      [callId => ({ type: HostToWorkerType.ApprovalUnavailable, callId, rendered: 'approval() needs a detached run' })],
    )
    expect(result).toMatchObject({ stopReason: 'error', error: expect.stringContaining('approval() needs a detached run') as string })
  })

  it('refuses a request without a non-empty title, without asking the host', async () => {
    const { asked, result } = await run("await approval({ title: '' }); return 'shipped'", [])
    expect(asked).toEqual([])
    expect(result).toMatchObject({ stopReason: 'error', error: expect.stringContaining('requires { title }') as string })
  })

  it('refuses approval() in an execution built without the approval channel', async () => {
    const children: ChildPort = {
      startAgent: () => Promise.reject(new Error('no children in this case')),
      startNested: () => Promise.reject(new Error('no nested runs in this case')),
    }
    const quiet = { phase: () => {}, log: () => {}, agentStart: () => {}, agentEnd: () => {} }
    const execution = new WorkflowExecution(META, "await approval({ title: 'ship it' }); return 'shipped'", undefined, LIMITS, quiet, children)
    expect(await execution.drive()).toMatchObject({ stopReason: 'error', error: expect.stringContaining('not available in this execution') as string })
  })
})
