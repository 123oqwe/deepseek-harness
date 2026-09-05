/**
 * The Agent lifecycle state machine (Epic P4-05).
 *
 * `AgentStatus` in `./runtime-types.ts` is a two-value runtime flag —
 * `'idle' | 'running'` — which cannot express the states a supervisor must
 * distinguish to decide anything: a run waiting on a tool and a run waiting on
 * a human are both "running" there, yet only one of them will ever proceed
 * without an operator. This module adds the ten-state lifecycle those
 * decisions need, alongside that flag rather than replacing it.
 *
 * Two properties are structural here rather than left to callers:
 *
 * - **Every transition carries a reason, a `runId` and a lease epoch**
 *   (must[1]). They are required fields of {@link AgentTransition}, so a
 *   transition without them is not a value this module can construct.
 * - **A stale worker cannot move a lifecycle it no longer owns**
 *   (acceptance[0]). A worker's authority is its lease epoch, and an update
 *   from an older epoch is refused whatever it says.
 *
 * @module @deepseek-ai/dsh-agent/state-machine
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * The ten lifecycle states must[0] fixes, in the order it names them.
 *
 * `waiting_tool` and `waiting_human` are separate states rather than one
 * `waiting`, because acceptance[1] is about resource consumption and they
 * differ in kind: a tool wait ends on its own, a human wait does not end
 * without an operator, and a supervisor deciding whether to reclaim a lease
 * has to tell them apart.
 */
export type AgentLifecycleState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_tool'
  | 'waiting_human'
  | 'paused'
  | 'cancelling'
  | 'failed'
  | 'completed'
  | 'orphaned'

/** One run of an agent, opaque across the lease boundary. */
export type AgentRunId = Branded<'AgentRunId'>

/**
 * A lease epoch. Monotonic per run: a worker that acquires the lease receives
 * an epoch strictly greater than every epoch issued before it, so comparing
 * epochs is the whole of the staleness test — no clock, no heartbeat
 * timestamp, and nothing a stale worker can forge by retrying.
 */
export type LeaseEpoch = number

/**
 * States from which no transition is possible. Reaching one ends the run's
 * lifecycle, so a later update naming any of them as a source is stale by
 * construction rather than by policy.
 */
export const TERMINAL_STATES: readonly AgentLifecycleState[] = ['failed', 'completed']

/**
 * States in which the run holds no LLM call and no worker slot (acceptance[1]).
 *
 * `queued` is included because a queued run has not started; `paused`,
 * `waiting_tool` and `waiting_human` because the run has yielded its
 * execution slot while it waits. `cancelling` is deliberately EXCLUDED: a
 * cancelling run is still draining and may still hold both, so treating it as
 * idle would let a supervisor reclaim resources still in use.
 */
export const NON_CONSUMING_STATES: readonly AgentLifecycleState[] = [
  'queued',
  'paused',
  'waiting_tool',
  'waiting_human',
  ...TERMINAL_STATES,
  'orphaned',
]

/**
 * The legal transitions, as source state to permitted targets.
 *
 * Written as data rather than as branching code so the legality question has
 * exactly one answer for every pair, and so a reader can see the whole shape
 * without executing it.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<AgentLifecycleState, readonly AgentLifecycleState[]>> = {
  queued: ['starting', 'cancelling', 'failed', 'orphaned'],
  starting: ['running', 'cancelling', 'failed', 'orphaned'],
  running: ['waiting_tool', 'waiting_human', 'paused', 'cancelling', 'completed', 'failed', 'orphaned'],
  waiting_tool: ['running', 'cancelling', 'failed', 'orphaned'],
  waiting_human: ['running', 'cancelling', 'failed', 'orphaned'],
  paused: ['running', 'cancelling', 'failed', 'orphaned'],
  cancelling: ['failed', 'completed', 'orphaned'],
  // Terminal: a completed or failed run is over. Nothing follows, including
  // `orphaned` — a finished run cannot be orphaned, and admitting that edge
  // would let a reclaim sweep rewrite history it has no business touching.
  failed: [],
  completed: [],
  // acceptance[2]: an orphaned run is reclaimable. It may be resumed by a new
  // lease holder, or fail safely — never silently resumed as `running`
  // without passing through `starting`, which is what issues the new epoch.
  orphaned: ['starting', 'failed'],
}

/** One proposed lifecycle transition. Every field must[1] names is required. */
export interface AgentTransition {
  readonly from: AgentLifecycleState
  readonly to: AgentLifecycleState
  /** Why the transition was proposed. Free text, never empty. */
  readonly reason: string
  /** The run this transition belongs to. */
  readonly runId: AgentRunId
  /** The proposing worker's lease epoch. */
  readonly epoch: LeaseEpoch
}

/** Why a proposed transition was refused. */
export type TransitionDenialReason =
  /** `to` is not reachable from `from` under {@link LEGAL_TRANSITIONS}. */
  | 'illegal-transition'
  /** The proposal's epoch is older than the lifecycle's current epoch. */
  | 'stale-epoch'
  /** The proposal names a different run than the one being advanced. */
  | 'run-mismatch'
  /** `reason` was empty or whitespace, so the transition records nothing. */
  | 'missing-reason'

/** The outcome of proposing a transition. */
export type TransitionDecision =
  | { readonly admitted: true; readonly state: AgentLifecycleState; readonly epoch: LeaseEpoch }
  | { readonly admitted: false; readonly reason: TransitionDenialReason }

/** A lifecycle's current position, as held by whatever supervises the run. */
export interface AgentLifecycle {
  readonly runId: AgentRunId
  readonly state: AgentLifecycleState
  readonly epoch: LeaseEpoch
}

/**
 * Decide one proposed transition against a lifecycle's current position.
 *
 * Checks run in a fixed order — identity, then authority, then legality, then
 * completeness — because the refusal reason is itself evidence and a caller
 * that sees `stale-epoch` learns something different from one that sees
 * `illegal-transition`. Ordering identity and authority first means a stale
 * worker never learns whether its proposed edge would have been legal.
 * @param lifecycle - the run's current position.
 * @param transition - the proposed transition.
 * @returns the admitted state and epoch, or the refusal reason.
 */
export function decideTransition(lifecycle: AgentLifecycle, transition: AgentTransition): TransitionDecision {
  if (transition.runId !== lifecycle.runId) return { admitted: false, reason: 'run-mismatch' }
  // acceptance[0]'s stale-worker half. An equal epoch is the current lease
  // holder and is admitted; only a strictly older one is stale.
  if (transition.epoch < lifecycle.epoch) return { admitted: false, reason: 'stale-epoch' }
  if (transition.from !== lifecycle.state) return { admitted: false, reason: 'illegal-transition' }
  if (!LEGAL_TRANSITIONS[transition.from].includes(transition.to)) {
    return { admitted: false, reason: 'illegal-transition' }
  }
  if (transition.reason.trim() === '') return { admitted: false, reason: 'missing-reason' }
  return { admitted: true, state: transition.to, epoch: transition.epoch }
}

/**
 * Whether a state holds no LLM call and no worker slot (acceptance[1]).
 * @param state - the lifecycle state to classify.
 * @returns true when the state consumes neither resource.
 */
export function consumesNoResources(state: AgentLifecycleState): boolean {
  return NON_CONSUMING_STATES.includes(state)
}

/**
 * Whether a run in this state can still be advanced at all.
 * @param state - the lifecycle state to classify.
 * @returns true when no transition leaves this state.
 */
export function isTerminal(state: AgentLifecycleState): boolean {
  return LEGAL_TRANSITIONS[state].length === 0
}
