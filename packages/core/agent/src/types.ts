/**
 * Durable agent session-event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-agent/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
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
  /**
   * That a Run Service was mounted and this agent's lease was REFUSED
   * (first100 registry P4-07 must[0], acceptance[1]).
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer,
   * setting it in the same branch that declines to open a Run.
   *
   * **It exists because absence had two meanings and they need different
   * answers.** An agent with no {@link Agent.lifecycle} is either running in a
   * composition that mounts no Run Service — capability absence, which must
   * dispatch normally — or one whose lease a live store refused, which must
   * not dispatch at all. Measured before this field existed: the two were
   * indistinguishable, so a second host that lost the race for a work item
   * kept executing tools against it, which is the two-master state P4-07
   * exists to prevent.
   *
   * Never set on a successful acquisition, and never cleared: a refusal is
   * about this agent's one attempt to open its Run, and the agent does not get
   * a second.
   */
  leaseRefused?: true
  /**
   * The compiled TaskProfile this agent's first model step was planned from
   * (first100 registry P4-02 must[1], validation[2]), named by the digest of
   * its canonical form rather than carried inline.
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer,
   * setting it from its `agent/pre-step` listener at the first step — the
   * moment the goal, the identity and the budget are all in hand — after
   * appending the profile body to the session log as `run/task-profile` and
   * naming it in the Run's `accepted → planning` transition. Readers treat an
   * absent value as "no profile was compiled for this agent", which is the
   * ordinary case for a session whose first message is injected context rather
   * than a human goal, and never as a compile that failed.
   *
   * A reference and not the profile, for the same reason the Run event log
   * carries references: the body belongs to the session log that owns it, and
   * two copies of a durable fact have no way to detect divergence. Recompiling
   * an unchanged goal yields the same digest, so this field moving is itself
   * the signal that the profile was revised.
   *
   * **The brand is spelled here rather than imported, and the reason is the
   * dependency direction.** The type is `TaskProfileRef`
   * (`@deepseek-ai/dsh-task-profile/types`), which IS `Branded<'TaskProfileRef'>`
   * — so this declaration is that type, not a parallel one. Importing the name
   * would make the agent spine depend on a P4-02 vocabulary package, the
   * direction {@link Agent.runId} already avoids by taking `RunId` from
   * `identity/principal` rather than from `run/run`. It would also close a
   * project-reference cycle, since `@deepseek-ai/dsh-goal` depends on this
   * package and `run/task-profile` depends on that one. Divergence is caught
   * where it would matter: `RunPlugin`'s `agent.taskProfile = ref` does not
   * compile if the two stop being the same type.
   */
  taskProfile?: Branded<'TaskProfileRef'>
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
