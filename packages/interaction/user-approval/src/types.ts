/**
 * Wire-safe approval identifiers and outcome vocabulary, free of
 * cordis/service imports so browser type chains can
 * consume them without loading this package's Context augmentation.
 * @module @deepseek-ai/dsh-user-approval/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>

/**
 * Brand a string as an {@link ApprovalRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * An approval question was put to the answerer chain — log-only audit
     * (like `hook/*`; NOT a surface event, carries no `surfaceOp`). `id` pairs
     * it with the `approval/decided` that always follows; `toolName` names what
     * the question is about — usually a tool, and not necessarily a callable
     * one, `callId` the exact tool call when the asker had one, `subject` the
     * particulars when the name alone does not say which question this was,
     * and `reason` the asker's human-readable explanation (e.g. a hook's
     * permission-decision reason).
     */
    'approval/asked': {
      id: ApprovalRequestId
      toolName: string
      callId?: ToolCallId
      subject?: string
      reason?: string
    }
    /**
     * The outcome of a prior `approval/asked` (same `id`) — log-only audit.
     * Exactly one per ask, appended when the outcome is known: a decision, a
     * cancellation, or the fail-closed `'unavailable'`.
     */
    'approval/decided': {
      id: ApprovalRequestId
      outcome: ApprovalOutcome
    }
  }
}

/** Client-safe payload declared for the approval answerer waterfall. */
export interface ApprovalRequestEvent {
  /** Agent identity projected to the corresponding Client Context in transit. */
  readonly agent: Agent
  /**
   * The name of what is being decided.
   *
   * Usually a tool, and every asker before P1-07 was one. It is the NAME OF THE
   * SUBJECT rather than a registered tool id: a capability that is not callable
   * can be decided too — `workspace-trust` asks whether a host user trusts the
   * directory the session is running in. Required, and the runtime invariant
   * holds it non-empty, because an audit entry naming nothing is an audit entry
   * an operator cannot act on.
   */
  readonly toolName: string
  /** Exact tool call being decided, when available. */
  readonly callId?: ToolCallId
  /**
   * What exactly is being decided, when the name alone does not say.
   *
   * A tool call is identified by its `callId`; a decision about anything else
   * has no call to point at, so this carries the particulars — for a trust
   * question, which workspace and which state is being asked for. Audit-side:
   * it reaches `approval/asked` so a reader can tell two questions about the
   * same capability apart.
   */
  readonly subject?: string
  /** Human-readable reason supplied by the asker. */
  readonly reason?: string
  /** Cancellation lifetime of the pending request. */
  readonly signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Ask composed answerers for one decision. Return an outcome to claim the
     * request or call `next()` to delegate. Scope-filtered dispatch
     * (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @param req - pending approval request.
     * @mode waterfall
     */
    'approval/request'(
      this: Scoped<Agent>,
      req: ApprovalRequestEvent,
      next: () => Promise<ApprovalOutcome>,
    ): Promise<ApprovalOutcome>
  }
}

/**
 * The principal an approval is bound to, or an explicit statement that none was
 * attached (P2-06 acceptance[0]).
 *
 * `Agent.identity` is optional, so an agent may act with no principal attached.
 * `'unattached'` is a VALUE a verifier compares, not a missing field: an
 * approval given while nothing was attached must not be usable once a principal
 * IS attached, because that is a different actor than the one the decider saw.
 * The same argument `ExecutionWorldFact`'s `absent` won, and the reverse control
 * is the one that matters — unattached is not a wildcard.
 */
export type ApprovalPrincipal = PrincipalId | 'unattached'

/** Everything one approval is bound to, as the decider saw it (must[1]). */
export interface ApprovalBindingInputs {
  /** The action the decision is about. */
  readonly action: string
  /** The action's raw arguments, canonicalized by P2-03's form before digesting. */
  readonly args: JsonValue
  /** Who was acting when the decision was made. */
  readonly principal: ApprovalPrincipal
  /** The manifest's declared preconditions, in the order the manifest carries them. */
  readonly preconditions: readonly string[]
  /** Digest of the capability token presented, absent when the deployment issues none. */
  readonly capabilityToken?: string
  /** The policy set version the decision was made under, absent when no engine is mounted. */
  readonly policyVersion?: string
}

/** One approval's binding: what it covers, its digest, and when it lapses. */
export interface ApprovalBinding {
  /** Everything the approval is bound to. */
  readonly inputs: ApprovalBindingInputs
  /** Digest over the whole bound tuple, for the audit record. */
  readonly digest: ApprovalBindingDigest
  /**
   * When the approval stops being usable, as an absolute epoch millisecond.
   *
   * Compared against a `now` the CALLER supplies. Whose clock that is, and what
   * happens to an execution already in flight when it lapses, are the Usage
   * stage's: must[1] says re-verify BEFORE execution, so expiry is decided at
   * the re-verification moment and this stage introduces no mid-execution
   * revocation.
   */
  readonly expiresAtMs: number
}

/** Digest over an approval's whole bound tuple. */
export type ApprovalBindingDigest = Branded<'ApprovalBindingDigest'>

/**
 * Which bound field moved, as a closed set (must[2]).
 *
 * must[2] says any field change invalidates the approval, so the refusal
 * reasons ARE that enumeration: one per bound field. A boolean verifier would
 * satisfy neither clause observably — an operator cannot act on `false`, and
 * "the arguments changed" and "the policy version changed" call for different
 * actions.
 */
export type ApprovalBindingField
  = 'action' | 'arguments' | 'principal' | 'preconditions' | 'capability-token' | 'policy-version'

/** Why a bound approval may not be used, or that it may. */
export type ApprovalVerification
  = { readonly valid: true }
    | { readonly valid: false; readonly reason: 'changed'; readonly field: ApprovalBindingField }
    | { readonly valid: false; readonly reason: 'expired'; readonly expiresAtMs: number; readonly now: number }
