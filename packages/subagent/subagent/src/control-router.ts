/**
 * Route control messages to a live child, and hold cancellation open until its
 * participants have stopped (Epic P5-10, Provider stage).
 *
 * `./control-convergence.ts` decides; this dispatches. The split matters
 * because the decisions are the part worth pinning exactly — which phases admit
 * which kind, what a redelivery means, when a barrier is satisfied — while this
 * module is the wiring that puts a real `Agent` behind them.
 *
 * **The child's phase is not the Agent's status.** `AgentStatus` is `idle` or
 * `running` and nothing else; `cancelling`, `awaiting-human` and `terminal` are
 * states this router owns, because they describe where the child is in ITS
 * lifecycle rather than whether a turn happens to be executing. Deriving the
 * phase from `status` alone would make a cancelled-but-not-yet-converged child
 * indistinguishable from an idle one, which is the confusion acceptance[0] is
 * about.
 *
 * @module @deepseek-ai/dsh-subagent/control-router
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { decideControl, decideConvergence, orderByPriority } from './control-convergence.ts'
import type {
  ChildPhase,
  ControlDecision,
  ControlMessage,
  ConvergenceParticipant,
  ConvergenceState,
} from './control-convergence.ts'

/** A control message together with the payload its kind needs. */
export interface RoutedControl {
  readonly message: ControlMessage
  /** The message body, for the kinds that carry one; `cancel` carries none. */
  readonly payload?: UserMessage
}

/** What the router did with one submission. */
export interface RoutingOutcome {
  readonly decision: ControlDecision
  /** Which Agent operation ran; absent when the message was refused. */
  readonly dispatched?: 'followup' | 'steer' | 'inject' | 'cancel' | 'answer' | undefined
}

/**
 * One child's control state.
 *
 * Owned per child rather than per process: two children cancel independently,
 * and a shared epoch ledger would let one child's redelivery suppress
 * another's first delivery of the same number.
 */
export class ChildControlRouter {
  private phase: ChildPhase = 'running'
  private readonly appliedEpochs = new Set<number>()
  private readonly participants = new Map<string, boolean>()
  private waitingPointId: string | undefined

  /**
   * @param agent - the live child this router controls.
   * @param answerWaitingPoint - delivers a human answer to the waiting point
   *   that asked; absent when the deployment composes no question seam.
   */
  constructor(
    private readonly agent: Agent,
    private readonly answerWaitingPoint?: (waitingPointId: string, answer: UserMessage) => void,
  ) {
    // The child itself is always a participant: it is the one thing whose stop
    // this repository can observe today. must[3] also names `world` and
    // `actions`, which have no runtime entity yet (BLOCKED-116) and are NOT
    // pre-declared here — a supplier registers itself when it lands.
    this.participants.set('child', false)
  }

  /** The child's phase as this router understands it. */
  get currentPhase(): ChildPhase {
    return this.phase
  }

  /**
   * Register something whose stop cancellation must observe (must[3]).
   *
   * Open by design: the barrier takes a set, so a supplier that lands later
   * joins without this module learning its shape.
   * @param name - what to call it in the barrier's report.
   */
  addParticipant(name: string): void {
    if (!this.participants.has(name)) this.participants.set(name, false)
  }

  /**
   * Record that a participant has stopped, and settle the child if that was the
   * last one.
   * @param name - the participant that stopped.
   * @returns the barrier's state after the report.
   */
  participantStopped(name: string): ConvergenceState {
    this.participants.set(name, true)
    const state = decideConvergence(this.snapshotParticipants())
    // Terminal only from `cancelling`: a participant reporting a stop during an
    // ordinary run says nothing about the child being finished.
    if (state.converged && this.phase === 'cancelling') this.phase = 'terminal'
    return state
  }

  /** Note that the child is waiting on a specific human question (must[0]). */
  awaitHuman(waitingPointId: string): void {
    if (this.phase !== 'running') return
    this.waitingPointId = waitingPointId
    this.phase = 'awaiting-human'
  }

  /**
   * Submit one control message.
   *
   * The decision is made before anything is dispatched, so a refused message
   * reaches no Agent operation at all — acceptance[0]'s steer-beside-cancel is
   * refused rather than delivered and ignored, which is the difference between
   * a child that cannot be woken and one that merely usually is not.
   * @param routed - the message and its payload.
   * @returns the decision, and which operation ran.
   */
  submit(routed: RoutedControl): RoutingOutcome {
    const { message } = routed
    const decision = decideControl(message, this.phase, this.appliedEpochs, this.waitingPointId)
    if (!decision.applied) return { decision }
    this.appliedEpochs.add(message.controlEpoch)
    return { decision, dispatched: this.dispatch(routed) }
  }

  /**
   * Submit several messages that arrived together, most urgent first (must[1]).
   *
   * Ordered before any is applied: a `cancel` arriving beside a `steer` must
   * take effect first regardless of which the transport delivered first, or the
   * outcome would depend on scheduling.
   * @param batch - the messages that arrived together.
   * @returns one outcome per message, in the order they were applied.
   */
  submitBatch(batch: readonly RoutedControl[]): readonly RoutingOutcome[] {
    const byEpoch = new Map(batch.map(routed => [routed.message.controlEpoch, routed]))
    return orderByPriority(batch.map(routed => routed.message))
      .map(message => this.submit(byEpoch.get(message.controlEpoch) as RoutedControl))
  }

  /** The barrier's participants, as the decision function reads them. */
  private snapshotParticipants(): readonly ConvergenceParticipant[] {
    return [...this.participants].map(([name, stopped]) => ({ name, stopped }))
  }

  /** Perform the Agent operation one admitted message names. */
  private dispatch(routed: RoutedControl): RoutingOutcome['dispatched'] {
    const { message, payload } = routed
    switch (message.kind) {
      case 'cancel':
        this.phase = 'cancelling'
        this.agent.cancel({ kind: 'user' })
        return 'cancel'
      case 'continue':
        if (payload !== undefined) this.agent.followup(payload)
        this.leaveWaiting()
        return 'followup'
      case 'steer':
        if (payload !== undefined) this.agent.steer(payload)
        return 'steer'
      case 'inject':
        if (payload !== undefined) this.agent.inject(payload)
        return 'inject'
      case 'human-answer':
        // Delivered to the waiting point that asked, never to the child at
        // large (acceptance[1]): another question may be outstanding, and an
        // answer routed by child identity alone would satisfy the wrong one.
        if (payload !== undefined && message.waitingPointId !== undefined) {
          this.answerWaitingPoint?.(message.waitingPointId, payload)
        }
        this.leaveWaiting()
        return 'answer'
    }
  }

  /** Return to running once the thing the child was waiting for has arrived. */
  private leaveWaiting(): void {
    if (this.phase !== 'awaiting-human') return
    this.waitingPointId = undefined
    this.phase = 'running'
  }
}
