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
    /**
     * What one approval was BOUND to, recorded between the ask and the decision
     * (P2-06 must[1], acceptance[2]).
     *
     * Appended only when the asker supplied a binding, which is what keeps this
     * from claiming a binding for an ask that has none.
     *
     * **The arguments are present as a digest and never as values.** The
     * canonical arguments are what a redacted display exists to keep out of
     * sight, and this event is durable state a later reader replays — writing
     * them here would put the secret in the log the redaction protects. Every
     * other bound field is an identifier or a version and is carried whole, so
     * a re-verification can name WHICH field moved rather than only that
     * something did.
     *
     * The one-to-one reference acceptance[2] asks for is this event's two ends:
     * `id` names the approval, `action` names the action, and exactly one of
     * these is appended per bound ask.
     *
     * `ignorable: true` — a build that does not know this type must still read
     * the log; what an approval covered is auditable history, not a state the
     * runtime reconstructs.
     *
     * @param id - the approval this binding belongs to.
     * @param action - the action the decision is about.
     * @param digest - digest over the whole bound tuple.
     * @param principal - who was acting, or `unattached`.
     * @param preconditions - the manifest's declared preconditions, in order.
     * @param capabilityToken - digest of the token presented, absent when none was.
     * @param policyVersion - the policy set version, absent when no engine was mounted.
     * @param expiresAtMs - when the approval stops being usable.
     * @dshScopeScan unsupported
     */
    'approval/bound': {
      id: ApprovalRequestId
      action: string
      actionId?: string
      digest: string
      principal: string
      preconditions: readonly string[]
      capabilityToken?: string
      policyVersion?: string
      expiresAtMs: number
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
  /**
   * What this approval should be bound to, supplied by the asker (P2-06
   * must[1]).
   *
   * Optional because not every asker has a manifest behind it — a
   * workspace-trust question decides about a directory, not about an action
   * with canonical arguments — and an ask with no binding is still a valid ask.
   * What it is NOT is a default: an asker that has a tuple and omits it gets no
   * binding, and the absence is visible in the log as a missing
   * `approval/bound`.
   *
   * `askedAtMs` is the ASKER's clock reading, not the service's. The service
   * owns no clock, for the reason `dsh-lease-contract` states one layer over:
   * a decision function that reads the wall clock cannot be tested for expiry
   * without waiting for it.
   */
  /**
   * The six fields must[0] requires a decider to see, redacted for display.
   *
   * Optional for the same reason as {@link ApprovalRequestEvent.binding}: an ask
   * with no manifest behind it has none of them, and a workspace-trust question
   * decides about a directory. What it is NOT is a summary the answerer may
   * compose for itself — a surface that derived the risk class or the diff from
   * the tool name would be showing its own guess where the manifest has a fact.
   */
  readonly display?: ApprovalDisplay
  readonly binding?: {
    /** Everything the approval is to be bound to, as the asker sees it now. */
    readonly inputs: ApprovalBindingInputs
    /** The asker's clock reading at the moment of the ask. */
    readonly askedAtMs: number
    /**
     * The id of the dispatch this decision is about (acceptance[2]).
     *
     * Both dispatch paths supply it, because both hold their manifest's
     * `actionId` at the ask. It is what makes the reference one-to-one: the
     * record's `action` is a tool NAME, and two calls to one tool in a session
     * are otherwise the same line in the log. Absent only for an ask with no
     * dispatch behind it — `workspace-trust` decides about a directory — where
     * filling one in would put a value in the audit log naming no action.
     */
    readonly actionId?: string
  }
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

/**
 * What a decider is shown about the action being decided (must[0]).
 *
 * Every field is a value the manifest or the gate already produced, carried
 * rather than recomputed: the six exist so a human decides about the action
 * that will run, and a surface that re-derived any of them would be showing a
 * second opinion about the same call.
 *
 * `arguments` is the REDACTED rendering. The digest the approval is bound to
 * covers the unredacted canonical value, so what is shown and what is bound are
 * deliberately different strings — that difference is acceptance[1].
 */
export interface ApprovalDisplay {
  /** Digest of the manifest the decision is about, so a log reader can find it. */
  readonly manifestDigest: string
  /** The arguments as the decider should see them, already redacted. */
  readonly arguments: string
  /** What the action touches — a path, a command, a remote object. */
  readonly resource: string
  /** The class the deployment's risk policy put this action in. */
  readonly riskClass: string
  /** What the action is expected to change, in the manifest's own words. */
  readonly expectedDiff: string
  /** When an approval given now stops being usable, as an absolute epoch millisecond. */
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
    | { readonly valid: false; readonly reason: 'ambiguous'; readonly action: string; readonly candidates: number }
