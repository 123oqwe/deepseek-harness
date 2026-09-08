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
import type { ControlLedger } from './control-ledger.ts'
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
  private readonly participants = new Map<string, boolean>()
  private waitingPointId: string | undefined

  /**
   * @param agent - the live child this router controls.
   * @param answerWaitingPoint - delivers a human answer to the waiting point
   *   that asked; absent when the deployment composes no question seam.
   */
  constructor(
    /**
     * The manager's durable applied-epoch record (§12.26).
     *
     * Passed in rather than owned, because it must outlive this router: a
     * router is bound to a live child and a redelivery can arrive after that
     * child is gone. Holding it here is what made a mounted router lose
     * must[2]'s idempotency across a restart.
     */
    private readonly ledger: ControlLedger,
    /** The live child, absent once it has finished; `dispatch` needs one, deciding does not. */
    private readonly agent?: Agent,
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

  /**
   * Note that a cancel this router did not dispatch has been admitted.
   *
   * The manager's own interrupt path issues the cancel signal through the
   * subagent primitive — it authorizes a durable parent address against a live
   * Activation, which this router has no part in — and then tells the router
   * what happened. Recorded AFTER the primitive accepts, so a refused interrupt
   * leaves the child promptable rather than stranded in `cancelling`.
   */
  observeCancelled(): void {
    this.phase = 'cancelling'
  }

  /**
   * Note that the child is waiting on a specific human question (must[0]).
   * @param waitingPointId - the question the child is blocked on.
   */
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
    const decision = this.admit(routed.message)
    if (!decision.applied) return { decision }
    return { decision, dispatched: this.dispatch(routed) }
  }

  /**
   * Decide one control message and record it, WITHOUT dispatching (§12.26).
   *
   * The manager uses this where it performs its own delivery — a prompt
   * becomes attachments and an inbox insertion, which the router has no part
   * in — so that the decision and the epoch record are the router's while the
   * effect stays where it already was. Routing the prompt through
   * {@link ChildControlRouter.submit} instead would have required a live child
   * for a delivery that today works without one.
   * @param message - the arriving control message.
   * @returns whether it may be applied, and why not when not.
   */
  admit(message: ControlMessage): ControlDecision {
    const decision = this.decide(message)
    if (decision.applied) this.recordApplied(message.controlEpoch)
    return decision
  }

  /**
   * Decide one control message WITHOUT recording it (§12.26).
   *
   * Separate from {@link ChildControlRouter.recordApplied} because the manager
   * records only after its delivery SUCCEEDS. Idempotency protects against a
   * repeated effect, and a refused delivery had none — recording at decision
   * time made a failed delivery spend its request id, so every retry after the
   * first was refused as a duplicate of something that never happened. A
   * frozen case caught it.
   * @param message - the arriving control message.
   * @returns whether it may be applied, and why not when not.
   */
  decide(message: ControlMessage): ControlDecision {
    return decideControl(message, this.phase, this.ledger, this.waitingPointId)
  }

  /**
   * Record one control epoch as applied, after its effect happened.
   * @param controlEpoch - the epoch whose effect landed.
   */
  recordApplied(controlEpoch: number): void {
    this.ledger.add(controlEpoch)
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
    // No live child: the message was admissible and there is nothing to apply
    // it to. Reported by the caller as `no-child`, never as a duplicate.
    if (this.agent === undefined) return undefined
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
