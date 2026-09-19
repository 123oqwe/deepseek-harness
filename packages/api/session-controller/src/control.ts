/** Live Session queue, jobs, and projection state with reconnect baselines. */

import type { Context } from '@deepseek-ai/cordis'
// A type-only edge, for two things at once: the `declare module` that puts
// `control/state-changed` on cordis' `Events` -- without it `ctx.on` falls back
// to an untyped listener, the event name goes unchecked and the payload arrives
// as `any` -- and the service type below, so a rename of `state()` is a
// compile error here rather than a baseline that silently reports "unknown"
// forever. The peer is declared optional: a composition may mount no control
// plane, and this package's client face must not drag a host package in.
import type ControlPlaneService from '@deepseek-ai/dsh-control-plane/plugin'
import type { Agent, InboxState } from '@deepseek-ai/dsh-agent'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type {
  Session, SessionId, UserMessage,
} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  HostControlState,
  SessionControlBaseline,
  SessionControlFrame,
  SessionJob,
  SessionProjectionBaseline,
  SessionProjectionValues,
  SessionQueuedItem,
} from './types.ts'

/**
 * The control plane's own state type, taken from its reader rather than
 * imported.
 *
 * `ControlState` is declared in `@deepseek-ai/dsh-human-channel`, which this
 * package does not depend on and should not: one edge buys both the event
 * declaration and this type, and `ReturnType` names the declaration instead of
 * restating it.
 */
type ControlState = ReturnType<ControlPlaneService['state']>

/**
 * Project the control plane's state onto the one this API publishes.
 *
 * The surface-facing type is this package's ({@link HostControlState}), because
 * `src/types.ts` is compiled by the client face too and that program sees no
 * interaction package. So a mapping has to exist, and this file -- host-only --
 * is the one place that holds both types.
 * @param state - the control plane's state, as its event and its reader give it.
 * @returns the state as a surface receives it.
 */
function hostControlState(state: ControlState): HostControlState {
  // The source is a discriminated union, so this narrows rather than guards:
  // `stopped: true` carries its record by construction, and a branch for a
  // malformed value would be a check the type system already made.
  if (!state.stopped) return { stopped: false }
  return {
    stopped: true,
    record: {
      requestedBy: state.record.requestedBy,
      reason: state.record.reason,
      requestedAtMs: state.record.requestedAtMs,
      release: state.record.release,
    },
  }
}

/** Owns the Host-wide Session control stream. */
export class SessionControlController {
  private readonly streams = new Set<ControlQueue>()

  /** @param ctx - Host context carrying live Agent, projection, and jobs services. */
  constructor(private readonly ctx: Context) {
    ctx.sessionProjections.onChanged((session, key, value, seq) => {
      this.broadcast({
        type: 'projection',
        sessionId: session.id,
        key,
        value: value as JsonValue,
        seq,
      })
      if (key !== 'inbox') return
      const agent = this.ctx.agents.get(session.id)
      if (agent?.session !== session) return
      this.broadcast({
        type: 'queue',
        sessionId: session.id,
        items: queueItemsFromInbox(value as InboxState),
      })
    })
    ctx.inject(['jobs'], (jobsCtx) => {
      jobsCtx.jobs.onJobsChanged((owner) => { this.onJobsChanged(owner) })
    })
    // P2-12 acceptance[3]: the host's control state reaches this surface the
    // moment it changes. `ctx.on` and not a poll -- the stream's contract is
    // one baseline then replacements, and a poll would put this surface on its
    // own schedule, which is exactly the disagreement the clause forbids.
    // Listening unconditionally: the emitter is a different package and may
    // mount after this one, and an `inject` would make the subscription
    // conditional on a mount order this controller does not own.
    ctx.on('control/state-changed', (state) => {
      this.broadcast({ type: 'control', state: hostControlState(state) })
    })
    ctx.on('session/created', (session) => {
      const jobs = this.jobsFor(this.ctx.agents.get(session.id))
      if (jobs.length > 0) this.broadcast({ type: 'jobs', sessionId: session.id, jobs })
    })
    ctx.effect(() => () => {
      for (const stream of this.streams) stream.end()
      this.streams.clear()
    }, 'session-controller.control')
  }

  /**
   * Open one generation of Host-wide live control state.
   * @param signal - Remote stream cancellation.
   * @returns one complete baseline followed by live replacement frames.
   */
  async *control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    signal.throwIfAborted()
    const queue = new ControlQueue()
    this.streams.add(queue)
    try {
      yield { type: 'baseline', value: this.baseline() }
      yield* queue.iterate(signal)
    } finally {
      this.streams.delete(queue)
      queue.end()
    }
  }

  private baseline(): SessionControlBaseline {
    const sessions = this.ctx.sessions.list()
    const queues = Object.create(null) as Record<SessionId, readonly SessionQueuedItem[]>
    const jobs = Object.create(null) as Record<SessionId, readonly SessionJob[]>
    for (const session of sessions) {
      const agent = this.ctx.agents.get(session.id)
      queues[session.id] = agent?.session === session ? queueItems(agent) : []
      jobs[session.id] = this.jobsFor(agent)
    }
    // Read through on every baseline rather than cached from the last event: a
    // surface connecting AFTER a stop was raised missed that emission, and the
    // whole point of the baseline is that it does not need to have been
    // listening.
    //
    // An ANNOTATION widening to `| undefined`, not an assertion: the service
    // declaration types this key as always present, and it is not -- a
    // composition may mount no control plane, and the peer is declared
    // optional for that reason. Written as a cast, the linter rejects it as
    // unnecessary, which is the type system saying the widening is the whole
    // content. `undefined` here means the state is UNKNOWN, never "not
    // stopped", and the baseline omits the key rather than answering.
    const plane: ControlPlaneService | undefined = this.ctx.get('controlPlane')
    const control = plane === undefined ? undefined : hostControlState(plane.state())
    return {
      queues,
      jobs,
      projections: this.projectionBaseline(sessions),
      ...control === undefined ? {} : { control },
    }
  }

  private projectionBaseline(
    sessions: readonly Session[],
  ): Readonly<Record<SessionId, SessionProjectionBaseline>> {
    const blocks = Object.create(null) as Record<SessionId, SessionProjectionBaseline>
    for (const session of sessions) {
      const snapshot = this.ctx.sessionProjections.snapshot(session)
      blocks[session.id] = {
        asOfSeq: snapshot.asOfSeq,
        // Every projection definition validates its value before snapshot publication.
        values: snapshot.values as SessionProjectionValues,
      }
    }
    return blocks
  }

  private onJobsChanged(owner: Agent | undefined): void {
    if (owner !== undefined) {
      this.broadcast({ type: 'jobs', sessionId: owner.id, jobs: this.jobsFor(owner) })
      return
    }
    for (const session of this.ctx.sessions.list()) {
      this.broadcast({
        type: 'jobs',
        sessionId: session.id,
        jobs: this.jobsFor(this.ctx.agents.get(session.id)),
      })
    }
  }

  private jobsFor(agent: Agent | undefined): SessionJob[] {
    const jobs = this.ctx.get('jobs')
    return jobs === undefined ? [] : jobs.list(agent).map(jobView)
  }

  private broadcast(frame: SessionControlFrame): void {
    for (const stream of this.streams) stream.push(frame)
  }
}

class ControlQueue {
  private readonly buffer = new Deque<SessionControlFrame>()
  private wake: (() => void) | undefined
  private done = false

  push(frame: SessionControlFrame): void {
    if (this.done) return
    this.buffer.pushBack(frame)
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  end(): void {
    if (this.done) return
    this.done = true
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  async *iterate(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!this.done && !signal.aborted) {
        const frame = this.buffer.popFront()
        if (frame !== undefined) {
          yield frame
          continue
        }
        await new Promise<void>((resolve) => { this.wake = resolve })
      }
      while (this.buffer.size > 0 && !signal.aborted) yield this.buffer.popFront() as SessionControlFrame
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.end()
    }
  }
}

function queueItems(agent: Agent): SessionQueuedItem[] {
  return queueItemsFromInbox({
    'next-turn': agent.inbox.nextTurn,
    'next-step': agent.inbox.nextStep,
  })
}

function queueItemsFromInbox(inbox: InboxState): SessionQueuedItem[] {
  return [
    ...inbox['next-turn'].map(message => ({
      id: message.id,
      placement: 'queued' as const,
      ...promptRpcId(message),
      message: { id: message.id, content: message.content as unknown as JsonValue[] },
    })),
    ...inbox['next-step'].map(message => ({
      id: message.id,
      placement: message.source.kind === 'user' ? 'steering' as const : 'context' as const,
      ...promptRpcId(message),
      message: { id: message.id, content: message.content as unknown as JsonValue[] },
    })),
  ]
}

/** Prompt-RPC identity carried by a browser-submitted message's user source. */
function promptRpcId(message: UserMessage): Pick<SessionQueuedItem, 'rpcId'> {
  const source = message.source
  return source.kind === 'user' && 'rpcId' in source ? { rpcId: source.rpcId } : {}
}

function jobView(job: JobSnapshot): SessionJob {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  }
}
