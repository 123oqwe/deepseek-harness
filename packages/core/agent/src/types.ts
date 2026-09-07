/**
 * Durable agent session-event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-agent/types
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm/types'
import type { IdentityContext, RunId } from '@deepseek-ai/dsh-principal/types'
import type { RunLease } from '@deepseek-ai/dsh-lease-contract'
import type { AgentLifecycle } from './state-machine.ts'
import type { OptionalSessionSeq, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { TypertContext, TypertLookup } from '@deepseek-ai/dsh-typert-protocol'

/** Public live-agent handle; the runtime face augments its live capabilities. */
export interface Agent {
  /** Session-backed Agent identity. */
  readonly id: SessionId
  /**
   * Which principal is acting as this agent, and its full delegation chain
   * back to root (first100 registry P2-01 acceptance[0]). Optional: absent
   * for an agent with no identity attached. `ReactLoopAgent`
   * (`@deepseek-ai/dsh-agent-loop`) is the real producer, resolving it from
   * `AgentOptions.identity` and the session's already-recorded identity via
   * `resolveSessionIdentity` (`@deepseek-ai/dsh-agent-loop/runtime-context`).
   */
  readonly identity?: IdentityContext
  /**
   * Which Run this agent's session is doing work inside (first100 registry
   * P4-01 acceptance[2]). Optional: absent when no Run Service is mounted.
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer,
   * assigning it from its `agent/session-start` listener before any turn
   * runs. Deliberately not `readonly`: the Run Service owns the Run, not the
   * agent (P4-01 must[2]), so the association is attached by that service
   * rather than minted in the agent's own constructor the way `identity` is.
   * Readers treat an absent value as capability absence, never as a Run that
   * failed to open.
   */
  runId?: RunId
  /**
   * This agent run's position in the lifecycle, and the authority every state
   * write it makes is checked against (first100 registry P4-05 must[1], P4-07
   * must[1]).
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer.
   * It sets this beside {@link Agent.runId} when it opens the Run, having
   * taken that Run's lease from `ctx.leaseStore`, and it advances it. The
   * `epoch` here is one a lease store ISSUED, never one a caller chose — that
   * is the whole difference between this field and a number, and why
   * `advanceAgentLifecycleFenced` rather than `advanceAgentLifecycle` is the
   * entry point that may move it.
   *
   * Absent when no Run Service is mounted, or when the Run's lease was
   * refused. A reader treats absence as "this agent may not make authorized
   * state writes", never as a lifecycle at its initial state.
   */
  lifecycle?: AgentLifecycle
  /**
   * The lease this agent's Run holds, and the authority every state write it
   * makes presents (first100 registry P4-07 must[1]).
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer,
   * setting it beside {@link Agent.lifecycle} from the same acquisition.
   *
   * It lives on the Agent rather than behind the Run Service so that a
   * dispatcher can present it WITHOUT depending on that service: the agent
   * loop is where tool calls are dispatched and `@deepseek-ai/dsh-run` already
   * depends on the agent loop, so a reverse call would be a cycle. Absent
   * means this agent holds no Run and may make no authorized state write.
   */
  runLease?: RunLease
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    agent: TypertLookup<Agent, SessionId>
  }

  interface TypertContextMap {
    /** Agent Context identity shared by Host and Client adapters. */
    agent: TypertContext<SessionId>
  }
}

/** One of the two ordered pending-message lists owned by an agent. */
export type InboxTarget = 'next-turn' | 'next-step'

/**
 * Turn and step boundaries folded from one agent session log.
 *
 * Reader contract: the key is registered by `dsh-agent-loop` and absent
 * otherwise. Without agent-loop no turn events exist, so readers treat an
 * absent key as "no open turn / no boundaries" — capability absence, not a
 * corrupt state. A reader whose behavior has no safe fallback for that
 * absence (the step-open decision, for example) may fail loud instead.
 */
export interface TurnBoundaryProjection {
  /** Seq of the open turn's `turn/start`, or null between turns. */
  readonly openTurnStartSeq: OptionalSessionSeq
  /** Seq of the latest `step/start` event, or null before the first step. */
  readonly lastStepStartSeq: OptionalSessionSeq
  /** The latest step boundary (`step/start` or `step/end`) and its seq, or null before the first step boundary. */
  readonly lastStepBoundary: { readonly kind: 'start' | 'end'; readonly seq: SessionSeq } | null
  /** Turn number of the latest `turn/start`; 0 before the first turn. */
  readonly lastTurn: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * Live dispatch precedes projection mutation, so synchronous observers may
     * read the pre-splice inbox to recover the removed messages.
     */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
  }
}
