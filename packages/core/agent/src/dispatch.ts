/**
 * Agent-scoped dispatch and prompt assembly helpers. The fused dispatcher
 * {@link agentEvents} couples the agent subject to its scope carrier, so the
 * scope key and the payload's `agent` cannot diverge; repeat dispatchers (the
 * loop driver) build it once in the agent's constructor and reuse it.
 * @module @deepseek-ai/dsh-agent/dispatch
 */

import { checkFencing, type FencingToken, type Lease } from '@deepseek-ai/dsh-lease'
import type { Context, Events } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { consumesNoResources, decideTransition } from './state-machine.ts'
import type { AgentLifecycle, AgentTransition, TransitionDenialReason } from './state-machine.ts'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from './types.ts'

/** Extract the parameter tuple from an event handler type (its `this` is not part of the tuple). */
type Params<F> = F extends (...args: infer P) => unknown ? P : never
/** Extract the return type from an event handler type. */
type Return<F> = F extends (...args: never[]) => infer R ? R : never

/**
 * The event names whose subject is an agent: the handler's first parameter is
 * a payload object carrying the `agent` subject AND the handler declares a
 * `Scoped<Agent>` `this` (the scope-carrier contract). The `this` check keeps
 * accidental payload-happens-to-carry-an-Agent events (or zero-arg events,
 * whose parameter tuple would satisfy a bare rest-tuple check via callability)
 * out of the fused-dispatch surface.
 */
export type AgentSubjectEvent = {
  [K in keyof Events]: Events[K] extends (this: Scoped<Agent>, ...args: infer P) => unknown
    ? P extends [infer Payload, ...unknown[]]
      ? Payload extends { agent: Agent } ? K : never
      : never
    : never
}[keyof Events]

/** The full payload object of one agent-subject event. */
type PayloadOf<K extends AgentSubjectEvent> = Params<Events[K]> extends [infer Payload, ...unknown[]] ? Payload : never

/** The event arguments AFTER the payload: the waterfall `next` when present. */
type Tail<K extends AgentSubjectEvent> = Params<Events[K]> extends [unknown, ...infer R] ? R : never

/**
 * The payload as emit-side callers pass it: the full payload minus the agent
 * field, which the fused dispatcher injects so subject and scope key cannot
 * diverge.
 */
type PayloadRest<K extends AgentSubjectEvent> = Omit<PayloadOf<K> & object, 'agent'>

/**
 * The fused dispatcher {@link agentEvents} returns: each method dispatches the
 * named agent-subject event with the agent's scope carrier as `thisArg` and
 * the agent itself injected into the payload.
 */
export interface AgentEventDispatch {
  /**
   * Fire-and-forget notification in the agent's scope. Every listener is
   * invoked; synchronous throws and returned-promise rejections are logged and
   * contained per listener, so a notification cannot veto lifecycle progress
   * or starve a later observer.
   * @param name - the agent-subject event to emit.
   * @param payload - the event's payload fields; `agent` is injected.
   */
  emit<K extends AgentSubjectEvent>(name: K, payload: PayloadRest<K>): void
  /**
   * Awaited in-order dispatch (Cordis `serial`) in the agent's scope.
   * @param name - the agent-subject event to dispatch.
   * @param payload - the event's payload fields; `agent` is injected.
   * @returns the serial chain's result (the first bail value, if any).
   */
  serial<K extends AgentSubjectEvent>(name: K, payload: PayloadRest<K>): Promise<Awaited<Return<Events[K]>>>
  /**
   * Around-middleware dispatch (Cordis `waterfall`) in the agent's scope. The
   * declared event parameters already end with the `next` callback, so `rest`
   * is exactly the event's arguments after the payload — the final element
   * being the innermost `next` (the default the listener chain wraps).
   * @param name - the agent-subject event to dispatch.
   * @param payload - the event's payload fields; `agent` is injected.
   * @param rest - the event's arguments after the payload (the `next` callback).
   * @returns the waterfall's composed result.
   */
  waterfall<K extends AgentSubjectEvent>(name: K, payload: PayloadRest<K>, ...rest: Tail<K>): Return<Events[K]>
}

/**
 * Build the fused scope carrier for one agent subject.
 *
 * The carrier is a stateless routing object. {@link agentEvents} accepts an
 * existing carrier, so callers that dispatch repeatedly for the same agent
 * (the loop driver) build it once in the agent's constructor and reuse it,
 * keeping hot-path dispatches allocation-free.
 * @param agent - the subject agent and scope key.
 * @returns the carrier passed as the event dispatcher `this` value.
 */
export function agentCarrier(agent: Agent): Scoped<Agent> {
  return scopeTarget(agent, agent)
}

/**
 * Build a dispatcher that couples the agent subject to its scope carrier.
 * @param ctx - the context to dispatch through (any context of the app).
 * @param agent - the subject agent; also the scope-carrier key.
 * @param carrier - the scope carrier to dispatch through; defaults to
 * {@link agentCarrier} for the agent. Pass a constructor-built carrier to
 * avoid rebuilding it for every dispatch.
 * @returns the fused dispatcher.
 */
export function agentEvents(ctx: Context, agent: Agent, carrier: Scoped<Agent> = agentCarrier(agent)): AgentEventDispatch {
  // The ordinary dispatch methods forward through Cordis' variadic mixins. The
  // fused (carrier, name, payload, ...rest) tuple is provably a valid argument
  // list for the matching thisArg overload, but TypeScript cannot relate the
  // generic Tail<K> spread back to that overload's conditional parameter
  // tuple — hence one contained, shape-preserving cast per method.
  const fused = <K extends AgentSubjectEvent>(payload: PayloadRest<K>): PayloadOf<K> =>
    // The dispatcher owns the subject injection; callers pass PayloadRest, so
    // the fused record is exactly the declared payload. The spread comes
    // first, so a structurally acceptable payload that happens to carry an
    // `agent` field can never override the injected subject.
    ({ ...payload, agent } as PayloadOf<K>)
  return {
    emit(name, payload) {
      // Cordis emit invokes callbacks through Array.map: one synchronous throw
      // starves later listeners, and returned promises are discarded. Agent
      // notifications are non-vetoing, so resolve the same filtered callback
      // set ourselves and contain both failure modes independently.
      const args: unknown[] = [carrier, name, fused(payload)]
      const callbacks = ctx.events.dispatch('emit', args)
      for (const callback of callbacks) {
        try {
          const returned: unknown = callback(...args)
          void Promise.resolve(returned).catch((error: unknown) => {
            ctx.logger.warn(`agent event "${name}" listener rejected: ${String(error)}`)
          })
        } catch (error: unknown) {
          ctx.logger.warn(`agent event "${name}" listener threw: ${String(error)}`)
        }
      }
    },
    async serial(name, payload) {
      // oxlint-disable-next-line typescript/unbound-method -- the events mixin accessor returns a pre-bound function
      const serial = ctx.serial as (thisArg: Scoped<Agent>, name: string, ...args: unknown[]) => Promise<never>
      return await serial(carrier, name, fused(payload))
    },
    waterfall(name, payload, ...rest) {
      // oxlint-disable-next-line typescript/unbound-method -- the events mixin accessor returns a pre-bound function
      const waterfall = ctx.waterfall as (thisArg: Scoped<Agent>, name: string, ...args: unknown[]) => never
      return waterfall(carrier, name, fused(payload), ...rest)
    },
  }
}

/**
 * Emit one contained agent notification without allocating a retained dispatcher.
 * @param ctx - the context to dispatch through.
 * @param agent - the subject agent and scope key.
 * @param name - the agent-subject event to emit.
 * @param payload - the event's payload fields; `agent` is injected.
 */
export function emitAgentEvent<K extends AgentSubjectEvent>(
  ctx: Context,
  agent: Agent,
  name: K,
  payload: PayloadRest<K>,
): void {
  agentEvents(ctx, agent).emit(name, payload)
}

/**
 * Build the prompt assembly context with agent and scope set together, so
 * agent-scoped prompt and tool contributions cannot be silently omitted.
 * @param agent - the agent the assembly is for.
 * @param signal - the current turn's explicit control signal, when assembly belongs to a turn.
 * @returns the context to pass to `assemble()`.
 */
export function assembleContextFor(agent: Agent, signal?: AbortSignal): AssembleContext {
  return { agent, scope: agent, ...signal === undefined ? {} : { signal } }
}


/**
 * Advance one agent's lifecycle, refusing anything the state machine refuses
 * (Epic P4-05 acceptance[0]).
 *
 * This is the Usage-stage entry point: it is where a lifecycle transition
 * actually happens, so it is where must[1]'s reason/runId/epoch stop being a
 * type requirement and become a runtime one. Callers cannot route around it
 * by constructing a state value directly — `decideTransition` is the only
 * function that produces an admitted state, and it requires all three fields.
 *
 * Returns the decision rather than throwing, because a refused transition is
 * an ordinary outcome a supervisor must record: a stale worker being turned
 * away is the system working, not an exception.
 * @param lifecycle - the run's current position.
 * @param transition - the proposed transition.
 * @returns the next lifecycle on success, or the refusal.
 */
export function advanceAgentLifecycle(
  lifecycle: AgentLifecycle,
  transition: AgentTransition,
): { readonly ok: true; readonly next: AgentLifecycle } | { readonly ok: false; readonly reason: TransitionDenialReason } {
  const decision = decideTransition(lifecycle, transition)
  if (!decision.admitted) return { ok: false, reason: decision.reason }
  return { ok: true, next: { runId: lifecycle.runId, state: decision.state, epoch: decision.epoch } }
}

/**
 * Whether an agent in this lifecycle state should hold a dispatch slot
 * (Epic P4-05 acceptance[1]).
 *
 * The inverse of `consumesNoResources`, expressed here rather than imported
 * raw so the dispatch layer states its own rule: a scheduler asks this
 * function, not the state list, and the two cannot drift because there is
 * only one of them.
 * @param lifecycle - the run's current position.
 * @returns true when the run should occupy a slot.
 */
export function holdsDispatchSlot(lifecycle: AgentLifecycle): boolean {
  return !consumesNoResources(lifecycle.state)
}

/**
 * Advance a lifecycle only when a fencing token authorizes it (Epic P4-07
 * must[1]: every state write carries a fencing token).
 *
 * {@link advanceAgentLifecycle} alone cannot enforce authority, and the reason
 * is structural rather than an oversight: nothing issues the lifecycle's
 * epoch. `decideTransition` refuses a strictly OLDER epoch and then adopts
 * whatever the proposal carried, so the epoch a lifecycle holds is only ever
 * the last one a caller asserted. A worker proposing an epoch far above the
 * current one is admitted and becomes the new authority.
 *
 * That is safe exactly while no other component issues epochs, and P4-07's
 * `LeaseStore` ends that condition. This entry point closes the gap from the
 * outside rather than by editing P4-05's Contract surface: the token is
 * checked against the store's current lease FIRST, so the epoch reaching
 * `decideTransition` is one the store issued rather than one the caller chose.
 *
 * The two staleness rules stay deliberately different, and the difference is
 * not a contradiction. `decideTransition` compares against a lifecycle that
 * LEARNS its epoch from transitions, so it must admit a newer one.
 * `checkFencing` compares against a store that ISSUES epochs, so anything but
 * the current one is a forgery. Running the issuer's check first is what makes
 * the lifecycle's more permissive rule unreachable by an attacker.
 * @param lifecycle - the run's current position.
 * @param transition - the proposed transition.
 * @param token - the proposing worker's authority.
 * @param lease - the work item's current lease, from the store.
 * @returns the next lifecycle, or the refusal — `'fenced'` when the token was rejected.
 */
export function advanceAgentLifecycleFenced(
  lifecycle: AgentLifecycle,
  transition: AgentTransition,
  token: FencingToken,
  lease: Lease | undefined,
): { readonly ok: true; readonly next: AgentLifecycle }
  | { readonly ok: false; readonly reason: TransitionDenialReason | 'fenced' } {
  const fencing = checkFencing(token, lease)
  if (!fencing.admitted) return { ok: false, reason: 'fenced' }
  return advanceAgentLifecycle(lifecycle, transition)
}
