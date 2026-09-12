/**
 * Shared driver for in-process ONE-SHOT subagent providers. The agent factory's
 * creation transaction owns unpublished setup and rollback; after publication
 * the returned AgentHandle is the one quiescent lifecycle owner held by the
 * provider's caller.
 *
 * Continuable children never come through here: the continuation manager
 * composes and drives them directly, so this driver owns exactly one turn with
 * one result.
 *
 * @module @deepseek-ai/dsh-subagent-in-process-driver
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { duringJobDrain, isTerminalJobStatus } from '@deepseek-ai/dsh-jobs'
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId, SessionLogOffset as SessionLogOffsetType, TurnEndReason } from '@deepseek-ai/dsh-session'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  assertSubagentMaxDepth,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  finalAssistantOutput,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentDescriptorData,
  SubagentResult,
  SubagentRun,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import {
  attachStructuredRuntime,
  type StructuredAttachment,
} from './structured.ts'

export {
  STRUCTURED_OUTPUT_TOOL,
  STRUCTURED_OUTPUT_INSTRUCTION,
} from './structured.ts'

/** Map a session turn outcome to the subagent seam's terminal vocabulary. */
function toStopReason(reason: TurnEndReason | undefined): SubagentStopReason {
  switch (reason?.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
      return 'aborted'
    // A pre-step rejection discarded the claimed prompt: the task was
    // declined, and the caller must not read the run as done.
    case 'blocked':
      return 'refusal'
    case 'error':
    case 'interrupted':
    default:
      return 'error'
  }
}

/** Extra inputs the spawn and fork providers supply to the shared driver. */
export interface InProcessRunOptions {
  /** Completed-turn seed for fork, or undefined for a fresh spawn. */
  readonly seed?: readonly SessionEvent[]
  /**
   * How long the child's run waits, in milliseconds, for background jobs it
   * started that have not settled when it goes idle (default 30s; `0` does not
   * wait).
   *
   * Resolved by the provider that mounts this driver, from its own validated
   * `Config` — the driver is a library and defaults nothing a deployment
   * should choose. Against the CHILD's own deadline rather than the parent's
   * remaining budget: the parent has no way to attribute its time to a
   * grandchild's work.
   */
  readonly waitForJobsMs?: number
}

/** Error used when cancellation wins before the child publication boundary. */
function prePublicationAbort(): Error {
  return new Error('subagent request was aborted before child publication')
}

/** Append one one-shot descriptor inside the child's initial turn before its first request. */
function attachDescriptorAppend(childCtx: Context, descriptor: SubagentDescriptorData): void {
  let appended = false
  childCtx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (!appended && decision.kind === 'enter') {
      appended = true
      agent.session.append('subagent/descriptor', descriptor)
    }
    return decision
  })
}

/**
 * Establish and drive one in-process one-shot child. Fulfillment means the agent
 * is already published in the registry and transfers its turn, cancellation,
 * and disposal work through the returned run. Rejection means the agent
 * factory's unpublished creation transaction reached quiescence without
 * publishing a child. Every start appends its resolved descriptor inside the
 * child's initial turn.
 * @param request - the trusted typed start request, including its required signal.
 * @param options - the optional fork seed.
 * @returns a published holder-owned run.
 */
export async function startInProcessRun(
  request: ResolvedSubagentStartRequest,
  options: InProcessRunOptions,
): Promise<SubagentRun> {
  assertSubagentMaxDepth(request.maxDepth)
  if (request.signal.aborted) throw prePublicationAbort()
  const parent = request.parent
  const childDepth = resolveChildDepth(parent, request.maxDepth)

  const childId = brandString<SessionId>(randomUUID())
  const seed = options.seed
  const activationBoundary = SessionLogOffset(seed?.length ?? 0)

  // Capture before the first await: a later parent switch belongs to the
  // parent's future.
  const inherited = captureDelegatedPolicyOverrides(parent)

  let structured: StructuredAttachment | undefined
  const setup = (childCtx: Context): void => {
    appendDelegatedPolicyOverrides((childCtx.agent as Agent).session, inherited)
    applyChildComposition(childCtx, parent, {
      persona: request.persona,
      toolFilter: request.toolFilter,
      childSession: childId,
      ...request.delegatingSession === undefined ? {} : { delegatingSession: request.delegatingSession },
    })
    if (request.outputSchema !== undefined) {
      structured = attachStructuredRuntime(childCtx, request.outputSchema)
    }
    attachDescriptorAppend(childCtx, request.descriptor)
  }

  const handle = await parent.ctx.agents.create({
    sessionId: childId,
    meta: childSessionMeta(parent, childDepth, seed !== undefined),
    ...seed !== undefined ? { seed } : {},
    ...seed === undefined ? {} : { inheritedEventCount: activationBoundary },
    agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth, childId),
    signal: request.signal,
    setup,
  })
  return drivePublishedRun(
    handle,
    request.signal,
    request.prompt,
    childId,
    activationBoundary,
    structured,
    options.waitForJobsMs ?? 30_000,
  )
}

/**
 * Wait, at most `boundMs`, for the background jobs this child had running when
 * its turn ended.
 *
 * Settlement is observed through `onJobDone` and not `jobs.wait(...)`: a
 * registered waiter makes the registry mark the job reported, which SUPPRESSES
 * the completion notice, so draining through `wait` would guarantee the model
 * never sees the result the drain exists to deliver.
 * @param child - the child agent whose owned jobs are drained.
 * @param boundMs - the wait bound in milliseconds; `0` returns immediately.
 */
async function drainChildJobs(child: Agent, boundMs: number): Promise<void> {
  const jobs = child.ctx.get('jobs')
  if (jobs === undefined || boundMs <= 0) return
  const pending = new Set(jobs.list(child).filter(job => !isTerminalJobStatus(job.status)).map(job => String(job.id)))
  if (pending.size === 0) return
  const deadline = new Promise<void>(resolve => setTimeout(resolve, boundMs).unref())
  await duringJobDrain(child, async () => {
    const settled = new Promise<void>((resolve) => {
      const stop = jobs.onJobDone((snapshot) => {
        pending.delete(String(snapshot.id))
        if (pending.size === 0) {
          stop()
          resolve()
        }
      })
      void deadline.then(stop)
    })
    await Promise.race([settled, deadline])
    await Promise.race([child.whenIdle(), deadline])
  })
}

/**
 * Record the background jobs a child started and never collected.
 *
 * A one-shot child's run ends when it goes idle, and the parent disposes its
 * handle straight after reading the result. A job still live at that point is
 * cancelled by the registry's owner cleanup and marked reported, so its output
 * reaches nobody. The same loss as the one-shot `dsh` profile's, one level down
 * (BLOCKED-220), and recorded for the same reason: so it is not silent.
 *
 * Nothing here reaches a model. The child's result is the parent's model-facing
 * output and is deliberately left alone.
 * @param child - the child agent whose owned jobs are read.
 */
function recordAbandonedChildJobs(child: Agent): void {
  const jobs = child.ctx.get('jobs')
  if (jobs === undefined) return
  const live = jobs.list(child).filter(job => !isTerminalJobStatus(job.status))
  if (live.length === 0) return
  for (const job of live) {
    // Appended to the CHILD's log, which is where the job was started and the
    // only log that can name it. No surface metadata: the parent's model sees
    // the child's result, and an abandoned job is not part of it.
    child.session.append('job/abandoned', {
      jobId: String(job.id),
      status: job.status as 'running' | 'stopping',
      surface: 'subagent',
    })
  }
  child.ctx.logger('subagent').warn(
    `child ${String(child.session.id)} finished with ${String(live.length)} background job(s) still running; their output was never collected: ${live.map(job => `${String(job.id)} (${job.status})`).join(', ')}`,
  )
}

/**
 * Wrap a published child in the single run lifecycle that owns signal handoff,
 * one turn, result settlement, and quiescent disposal.
 */
function drivePublishedRun(
  handle: AgentHandle,
  signal: AbortSignal,
  prompt: ContentBlock[],
  childId: SessionId,
  boundary: SessionLogOffsetType,
  structured: StructuredAttachment | undefined,
  waitForJobsMs: number,
): SubagentRun {
  const child = handle.agent
  const flags = { cancelled: false }
  const onAbort = (): void => {
    flags.cancelled = true
    child.cancel({ kind: 'parent' })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  // Agent creation detaches its creation-only listener before returning. The
  // post-registration check closes that handoff without treating an already
  // published child as a failed start.
  if (signal.aborted) onAbort()

  const result: Promise<SubagentResult> = (async () => {
    try {
      if (!flags.cancelled) {
        child.followup(createUserMessage({ content: prompt, source: { kind: 'user' } }))
        await child.whenIdle()
      }
      // Drain, then record, both before the result is read: after it the
      // parent disposes this handle and the registry's owner cleanup has
      // already swallowed the set.
      await drainChildJobs(child, waitForJobsMs)
      recordAbandonedChildJobs(child)
      return readResult(
        child,
        boundary,
        flags.cancelled,
        structured ? { captured: structured.captured() } : undefined,
      )
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  })()

  return {
    id: childId,
    localAgent: child,
    result,
    async dispose(): Promise<void> {
      signal.removeEventListener('abort', onAbort)
      flags.cancelled = true
      const settlements = await Promise.allSettled([handle.dispose(), result])
      const disposal = settlements[0]
      // The result channel owns run faults; disposal reports only failure to
      // release the published handle after both operations settle.
      if (disposal.status === 'rejected') throw disposal.reason
    },
  }
}

/** Read one settled child's result from events after its activation boundary. */
function readResult(
  child: Agent,
  boundary: SessionLogOffsetType,
  cancelled: boolean,
  structured?: { captured?: { value: unknown } | undefined },
): SubagentResult {
  const own = child.session.snapshotEvents(boundary)
  // `droppedUnrun` is deliberately unread: a one-shot prompt is claimed by its
  // awaited first turn almost immediately, and the owner's own teardown is the
  // `cancelled` flag below. A cancellation with no accounting turn resolves
  // `error` through `toStopReason(undefined)`, which never overstates success.
  const lastEnd = foldConsumedWork(own).end
  // The seam's canonical selection rule; a partial answer survives cancel and truncation.
  const output: ContentBlock[] = finalAssistantOutput(own) ?? []
  const recorded = toStopReason(lastEnd?.data.reason)
  // Disposal can tear the owner down before the loop records its ordinary
  // `aborted` end, yielding `disposed` instead.
  const stopReason: SubagentStopReason = cancelled && recorded !== 'completed' ? 'aborted' : recorded
  if (structured !== undefined) {
    if (structured.captured !== undefined) {
      return { output, structured: structured.captured.value, stopReason }
    }
    if (stopReason === 'completed') return { output, stopReason: cancelled ? 'aborted' : 'error' }
  }
  return { output, stopReason }
}
