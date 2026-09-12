/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
 * answerers fail closed; grants apply only to the requested action.
 * @module @deepseek-ai/dsh-user-approval
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
// Declaration merging only: `hasOpenAuditBracket` reads `command/run` /
// `command/done`, which `@deepseek-ai/dsh-commands` declares on the event map.
import type {} from '@deepseek-ai/dsh-commands/types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    approval: ApprovalService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's approval policy was switched — log-only, durable,
     * replayable, never in the model transcript (the model learns the policy
     * from the runtime-context snapshot and live switch notices). The LAST
     * such event is the session's override.
     * `source: 'delegation'` marks an override seeded into a child; an absent
     * source is a runtime switch.
     */
    'approval/policy': {
      policy: ApprovalPolicy
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
  }
}

import { ApprovalRequestId } from './types.ts'
import type {
  ApprovalBinding,
  ApprovalBindingInputs,
  ApprovalOutcome,
  ApprovalRequestEvent,
  ApprovalVerification,
} from './types.ts'
import { approvalBindingDigest } from './canonical.ts'

export { ApprovalRequestId } from './types.ts'
export type { ApprovalOutcome } from './types.ts'

/** Every {@link ApprovalOutcome}, for runtime normalization of answerer returns. */
const OUTCOMES: readonly ApprovalOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
export type ApprovalPolicy = 'ask' | 'never'

/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'never']

/** Model-facing statement for the deterministic `'never'` policy. */
const NEVER_SENTENCE = 'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).'
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = 'Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'

/**
 * Whether the log currently sits inside an open turn (a `turn/start` not yet
 * closed by a `turn/end`) — the {@link ApprovalService.request} precondition.
 * The audit pair must be enclosed by a durable bracket a reload can pair: a
 * BARE event, appended with nothing open around it, is indistinguishable from
 * a crash tail and silently dropped on reload.
 *
 * **Two brackets qualify, not one.** A turn is the obvious one and is what
 * every tool approval sits inside. A COMMAND run is the other: `command/run`
 * … `command/done` is an equally durable pair that replays coherently, and a
 * question asked inside it is not bare. Requiring a turn specifically was
 * measured as wrong by `/trust-skills`, the first and only shipped command that
 * asks for approval: the production dispatcher is `CommandsService.execute`
 * (`@deepseek-ai/dsh-commands`), which appends the command pair and never
 * opens a turn, and the composer submits commands from an IDLE session — so
 * the question threw on every real invocation (BLOCKED-205).
 *
 * The dispatcher opening a turn was the other way to close it, and was
 * rejected: a turn is the model-round-trip unit that the agent loop and
 * several projections count, and manufacturing an empty one to carry an
 * approval would pay for an audit problem with turn semantics.
 */
function hasOpenAuditBracket(session: Session): boolean {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const type = session.eventAt(SessionSeq(seq))?.type
    if (type === 'turn/start' || type === 'command/run') return true
    if (type === 'turn/end' || type === 'command/done') return false
  }
  return false
}

/**
 * Append the sole durable representation of a session policy override. Invalid
 * values throw before the log changes; consumers fold the new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void {
  if (!APPROVAL_POLICIES.includes(policy)) {
    throw new TypeError('approval policy must be one of "ask" or "never"')
  }
  session.append('approval/policy', { policy })
}

/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
export interface ApprovalRequest extends ApprovalRequestEvent {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /**
   * What the question is about, for presentation and audit.
   *
   * A tool for every asker that dispatches one, and the name of a capability
   * for one that does not: `workspace-trust` decides whether a host user
   * trusts a directory, which is a real capability and not a callable tool.
   * Pair it with {@link ApprovalRequest.subject} when the name alone does not
   * identify the question.
   */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: ToolCallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link ApprovalPolicy} for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance).
   */
  readonly policy?: ApprovalPolicy
}

/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. It exposes deterministic policy
 * changes to the model through the runtime-context snapshot and switch notices.
 */
export class ApprovalService extends Service {
  static Config: z<Config> = z.object({
    policy: z.union(['ask', 'never'] as const).default('ask'),
  })

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'approval')

    const effective = (agent: Agent): ApprovalPolicy => this.effectivePolicy(agent.session)

    // The complete current value travels after retained history, so switching
    // policy does not rewrite the stable system-prompt cache prefix.
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'approval:policy',
        order: scope.systemPrompt.getContextOrder('APPROVAL_POLICY'),
        text: (context) => {
          const agent = context.agent
          // A bare assemble() (tests, diagnostics) has no session to state.
          if (agent === undefined) return ''
          const policy = effective(agent)
          return policy === 'never' ? NEVER_SENTENCE : ASK_SENTENCE
        },
      })
    })
  }

  /**
   * Switch one live agent's policy and queue the transition for its next model
   * step. Session initialization uses {@link setApprovalPolicy} directly
   * because there is no previously visible policy to change.
   * @param agent - the live agent whose policy is changing.
   * @param policy - the new effective policy.
   */
  setPolicy(agent: Agent, policy: ApprovalPolicy): void {
    const previous = this.effectivePolicy(agent.session)
    if (previous === policy) return
    setApprovalPolicy(agent.session, policy)
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `The approval policy changed from "${previous}" to "${policy}" (changed by the user).`,
      }],
      source: { kind: 'plugin', plugin: 'user-approval' },
    }))
  }

  /**
   * Ask the composed answerers to decide one readonly same-process request.
   * The service borrows the request, agent, session, and live signal directly.
   * The request requires an open turn because the audit pair must be enclosed
   * by the durable log's commit/replay boundary; an idle ask rejects before
   * appending anything. The answerer phase always produces an outcome: an
   * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
   * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
   * normalized to `'unavailable'`. A failure that prevents either audit append
   * from committing still rejects because returning an unlogged decision would
   * violate the pair. Session contains post-commit observer failures, so an
   * authoritative append cannot reject the request or suppress its matching
   * audit event.
   * @param req - the pending decision (agent, tool identity, reason, signal).
   * @returns the closed outcome; `'allowed-once'` is the only grant.
   * @throws when no turn and no command run is open, or either audit event
   *   fails before the session append commit point.
   */
  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    const session = req.agent.session
    if (!hasOpenAuditBracket(session)) {
      throw new Error(
        'approval.request() outside an open turn or command: the approval/asked + approval/decided audit pair '
        + 'must be enclosed by a durable bracket (a bare event is crash-tail garbage on reload). '
        + 'Ask from inside the turn or the command run that needs the decision.',
      )
    }
    const id = ApprovalRequestId(randomUUID())
    session.append('approval/asked', {
      id,
      toolName: req.toolName,
      ...req.callId !== undefined ? { callId: req.callId } : {},
      ...req.subject !== undefined ? { subject: req.subject } : {},
      ...req.reason !== undefined ? { reason: req.reason } : {},
    })
    const outcome = await this.decide(req, session)
    session.append('approval/decided', { id, outcome })
    return outcome
  }

  /**
   * The session's effective policy: its own `approval/policy` fold, else the
   * configured default (the schema already defaulted an omitted policy to
   * `'ask'`; the `??` only narrows the optional-input TYPE).
   * @param session - the exact accepted session whose policy applies.
   * @returns the policy every ask for this session resolves under right now.
   */
  private effectivePolicy(session: Session): ApprovalPolicy {
    return this.overrideOf(session) ?? this.config.policy ?? 'ask'
  }

  /**
   * Read the session override without applying the configured default.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  overrideOf(session: Session): ApprovalPolicy | undefined {
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      const event = session.eventAt(SessionSeq(seq))
      if (event?.type === 'approval/policy') return event.data.policy
    }
    return undefined
  }

  /**
   * Dispatch the waterfall, contained and raced against the request signal.
   * @param req - the borrowed public request.
   * @param session - the request agent's session used for policy lookup.
   * @returns the normalized closed outcome.
   */
  private async decide(req: ApprovalRequest, session: Session): Promise<ApprovalOutcome> {
    const signal = req.signal
    if (signal?.aborted) return 'cancelled'
    // The 'never' policy is decided HERE, before any dispatch: a listener
    // registered with `prepend: true` after this service mounts would sit
    // ahead of any gate LISTENER, so a listener-shaped gate cannot keep the
    // documented promise that 'never' rejects deterministically regardless
    // of registration order — only the service's own request path can.
    if (this.effectivePolicy(session) === 'never') return 'rejected'
    // Enter the promise chain BEFORE dispatching: a listener that throws
    // SYNCHRONOUSLY (before its first await) must land in the same rejection
    // path as an async one — `Promise.resolve(call())` would let it escape
    // the containment into the caller.
    const answer: Promise<ApprovalOutcome> = Promise.resolve().then(
      () => this.ctx.waterfall(
        scopeTarget(req.agent, req.agent), 'approval/request', req,
        () => Promise.resolve<ApprovalOutcome>('unavailable'),
      ),
    ).then(
      // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
      // outcome instead of leaking it into callers' closed-union switches.
      outcome => OUTCOMES.includes(outcome) ? outcome : 'unavailable',
      // A throwing answerer must fail the QUESTION closed, not the caller's
      // tool call open — the seam contains its callbacks.
      () => 'unavailable',
    )
    if (signal === undefined) return answer
    return await new Promise<ApprovalOutcome>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        resolve('cancelled')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void answer.then((outcome) => {
        signal.removeEventListener('abort', onAbort)
        // After an abort won the race this resolve is a settled-promise no-op:
        // the late answer is discarded by construction.
        resolve(outcome)
      })
    })
  }
}

export default ApprovalService

/**
 * Bind one approval to everything the decider decided about (must[1]).
 *
 * The binding CAPTURES: every value here is read once, at ask time, and stored.
 * Re-verification compares against these recorded values rather than re-reading
 * the live ones, which is the whole of acceptance[0]: a verifier that resolved
 * the principal from the live `Agent`, or re-hashed the arguments it was handed,
 * would move with every substitution it exists to refuse and would still pass
 * any test written against it.
 * @param inputs - everything the approval is bound to, as the decider saw it.
 * @param expiresAtMs - when the approval stops being usable, absolute epoch milliseconds.
 * @returns the binding, with its digest.
 */
export function bindApproval(inputs: ApprovalBindingInputs, expiresAtMs: number): ApprovalBinding {
  return { inputs, digest: approvalBindingDigest(inputs), expiresAtMs }
}

/** Compare two precondition lists by order and content. */
function samePreconditions(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

/**
 * Decide whether a bound approval still authorizes the action now in hand
 * (must[1], must[2], acceptance[0]).
 *
 * Fields are compared in the order of {@link ApprovalBindingField} and the FIRST
 * difference is reported, so a refusal names one field rather than a set: an
 * operator acts on "the arguments changed" and on "the policy version changed"
 * differently, and a caller that changed two things is told about the first one
 * either way.
 *
 * Expiry is checked LAST, after the field comparison. A stale approval whose
 * arguments were also substituted is reported as a substitution, because that is
 * the fact worth acting on — reporting it as merely expired would let a
 * substitution attempt read as a timing accident.
 * @param binding - the approval's recorded binding.
 * @param present - the same tuple as it stands now, at re-verification time.
 * @param now - the caller's clock, in epoch milliseconds.
 * @returns validity, or the single field that moved, or expiry.
 */
export function verifyApprovalBinding(
  binding: ApprovalBinding,
  present: ApprovalBindingInputs,
  now: number,
): ApprovalVerification {
  const bound = binding.inputs
  if (present.action !== bound.action) return { valid: false, reason: 'changed', field: 'action' }
  // The arguments are compared by their canonical digest, never by re-hashing
  // whatever the caller passed into a fresh binding: the recorded value is the
  // one the decider saw.
  if (approvalBindingDigest({ ...bound, args: present.args }) !== binding.digest) {
    return { valid: false, reason: 'changed', field: 'arguments' }
  }
  if (present.principal !== bound.principal) return { valid: false, reason: 'changed', field: 'principal' }
  if (!samePreconditions(present.preconditions, bound.preconditions)) {
    return { valid: false, reason: 'changed', field: 'preconditions' }
  }
  if (present.capabilityToken !== bound.capabilityToken) {
    return { valid: false, reason: 'changed', field: 'capability-token' }
  }
  if (present.policyVersion !== bound.policyVersion) {
    return { valid: false, reason: 'changed', field: 'policy-version' }
  }
  if (now >= binding.expiresAtMs) {
    return { valid: false, reason: 'expired', expiresAtMs: binding.expiresAtMs, now }
  }
  return { valid: true }
}
