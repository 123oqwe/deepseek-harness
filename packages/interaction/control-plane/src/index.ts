/**
 * The control plane's decisions (Epic P2-12, Contract stage).
 *
 * Pure functions over a caller-supplied state: nothing here reads a store,
 * broadcasts, or settles anything. The kernel broadcast and the durable record
 * are the Provider stage; the lease gate and the answerer wiring are Usage.
 * Keeping the decisions separable is what lets the stop be driven directly —
 * injected before, during and after a tool start, which is validation[1].
 *
 * The channel that composes these decisions over a store, a broadcast and a
 * delivery seam is `./channel.ts`; it is not re-exported here because this
 * module is what it imports.
 *
 * @module @deepseek-ai/dsh-control-plane
 */

import type {
  AnswerDelivery,
  ControlState,
  ControlVerb,
  HumanAnswer,
  HumanChannelRefusal,
  HumanQuestion,
  StopRecord,
  WaitingPointId,
} from '@deepseek-ai/dsh-human-channel/types'

/**
 * What a control command does to the control state.
 *
 * `stop` and `released` are different outcomes from `unchanged` because an
 * audit reads the transition, not the resulting value: stopping an already
 * stopped run and stopping a running one leave the same state and are not the
 * same event.
 */
export type ControlDecision =
  /** The stop takes effect, and this record is what must be persisted. */
  | { readonly action: 'stop'; readonly record: StopRecord }
  /** The stop is lifted. Only an explicit resume produces this. */
  | { readonly action: 'released' }
  /** The command is a no-op against this state, and the reason says which. */
  | { readonly action: 'unchanged'; readonly because: 'already-stopped' | 'not-stopped' }
  /** The command is refused; `refusal` says why, in the channel's own vocabulary. */
  | { readonly action: 'refused'; readonly refusal: HumanChannelRefusal }

/**
 * Decide one control verb against the current state.
 *
 * **`resume` is the only verb that releases, and that is acceptance[2].** The
 * stop survives a restart and must be lifted explicitly, so no other verb and
 * no absence of a verb clears it: a recovering process that finds a record is
 * stopped until someone resumes, and `cancel-run` — which ends work — leaves
 * the stop standing, because ending a run is not a statement that new work may
 * start again.
 *
 * `kill-execution-world` is specified and refused as unimplemented. must[0]
 * lists the verb; P3-01 owns what an execution world is, and performing the
 * kill here would either duplicate that vocabulary or wait on it. A typed
 * refusal is readable by a caller; a silent no-op is not.
 * @param verb - the command to apply.
 * @param state - the control state the command is applied to.
 * @param request - who is asking and why, for the record a stop writes.
 * @returns the transition; only `stop` and `released` change the persisted state.
 */
export function decideControl(
  verb: ControlVerb,
  state: ControlState,
  request: Omit<StopRecord, 'release'>,
): ControlDecision {
  switch (verb) {
    case 'pause-new-actions':
      return state.stopped
        ? { action: 'unchanged', because: 'already-stopped' }
        : { action: 'stop', record: { ...request, release: 'explicit-resume' } }
    case 'cancel-run':
      // Ending the run does not lift a stop, and does not impose one either:
      // the in-flight work is settled by P4-06's outbox (terminate, or mark
      // reconciliation-required), which is acceptance[1]'s other half and not a
      // control-state transition.
      return state.stopped
        ? { action: 'unchanged', because: 'already-stopped' }
        : { action: 'unchanged', because: 'not-stopped' }
    case 'resume':
      return state.stopped ? { action: 'released' } : { action: 'unchanged', because: 'not-stopped' }
    case 'kill-execution-world':
      return { action: 'refused', refusal: { reason: 'verb-unimplemented', verb } }
    case 'ask-question':
      // Asking is not a state transition; it is an ask, and it goes through
      // `decideAsk` so that the stop gate and the destination check are one
      // decision rather than two a caller could perform in either order.
      return { action: 'unchanged', because: state.stopped ? 'already-stopped' : 'not-stopped' }
    default:
      return assertNever(verb)
  }
}

/**
 * Whether a worker may take a new lease or start a new action.
 *
 * must[2] in one predicate. It reads the control STATE rather than a flag the
 * caller cached, because the window this closes is exactly the one where a
 * worker decided it could proceed and then the stop arrived: a gate that
 * consults a value read earlier is a gate against the past.
 * @param state - the control state at the moment of the attempt.
 * @returns undefined when the attempt may proceed, or the refusal to report.
 */
export function mayStartNewWork(state: ControlState): HumanChannelRefusal | undefined {
  return state.stopped ? { reason: 'stopped', record: state.record } : undefined
}

/** The waiting points an asker may still be settled against. */
export interface WaitingPointRegistry {
  /** Whether this point is registered and unsettled. */
  readonly open: ReadonlySet<WaitingPointId>
  /** Points that existed and are gone — cancelled, timed out, or already settled. */
  readonly closed: ReadonlySet<WaitingPointId>
}

/**
 * Decide whether one question may be asked.
 *
 * The stop is checked BEFORE the destination, and the order is load-bearing: a
 * question is a new action, so a stopped run must be told `stopped` rather than
 * told its waiting point is unknown — the second answer would send a caller to
 * fix a registration that is not the problem.
 * @param question - the question, which names its own destination.
 * @param state - the control state at the moment of the ask.
 * @param registry - the waiting points that exist.
 * @param delivery - how an answer will reach the asker; required, never defaulted.
 * @returns the refusal, or undefined when the ask may proceed.
 */
export function decideAsk(
  question: HumanQuestion,
  state: ControlState,
  registry: WaitingPointRegistry,
  delivery: AnswerDelivery,
): HumanChannelRefusal | undefined {
  const stopped = mayStartNewWork(state)
  if (stopped !== undefined) return stopped
  if (registry.closed.has(question.waitingPoint)) {
    return { reason: 'waiting-point-vanished', waitingPoint: question.waitingPoint }
  }
  if (!registry.open.has(question.waitingPoint)) {
    return { reason: 'unknown-waiting-point', waitingPoint: question.waitingPoint }
  }
  // `delivery` is read, not merely accepted. A parameter a function never
  // touches is the state BLOCKED-215 describes from the inside: the seam was
  // present in the signature and absent from the behaviour.
  return typeof delivery.deliver === 'function' ? undefined : { reason: 'no-answerer' }
}

/** What settling one answer did. */
export type SettlementDecision =
  /** The answer reached the point that asked, and that point alone. */
  | { readonly action: 'settled'; readonly waitingPoint: WaitingPointId; readonly stillOpen: readonly WaitingPointId[] }
  /** The answer could not be placed; `refusal` says why, and the caller records it. */
  | { readonly action: 'refused'; readonly refusal: HumanChannelRefusal }

/**
 * Decide where one answer goes.
 *
 * **It returns what stays open, and that is the point.** acceptance[1] is "an
 * answer reaches only the waiting point that asked", which is a statement about
 * the points it did NOT reach — so the decision names them, and a case with two
 * outstanding questions can check the one that was not addressed. A decision
 * that returned only success would make the property unobservable from its own
 * result.
 *
 * A settlement for a point that is gone is a typed refusal rather than a
 * no-op. A no-op is indistinguishable from success at the call site, which is
 * how an answer that reached nobody reads as an answer delivered.
 * @param answer - the answer, carrying the waiting point it belongs to.
 * @param registry - the waiting points that exist.
 * @returns the settlement, naming what remains open.
 */
export function decideSettlement(answer: HumanAnswer, registry: WaitingPointRegistry): SettlementDecision {
  if (registry.closed.has(answer.waitingPoint)) {
    return { action: 'refused', refusal: { reason: 'waiting-point-vanished', waitingPoint: answer.waitingPoint } }
  }
  if (!registry.open.has(answer.waitingPoint)) {
    return { action: 'refused', refusal: { reason: 'unknown-waiting-point', waitingPoint: answer.waitingPoint } }
  }
  return {
    action: 'settled',
    waitingPoint: answer.waitingPoint,
    stillOpen: [...registry.open].filter(point => point !== answer.waitingPoint),
  }
}

/**
 * Refuse a verb this module cannot have reached.
 * @param verb - the unhandled value, typed `never` when every verb is handled.
 * @returns never; it throws.
 */
function assertNever(verb: never): never {
  throw new Error(`control-plane: unhandled control verb ${JSON.stringify(verb)}`)
}
