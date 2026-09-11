/**
 * The Policy Enforcement Point (Epic P2-05 must[2], acceptance[0]): the one
 * place a harness action is decided, whichever originator started it.
 *
 * The DECISION comes from `ctx.policy`; the ENFORCEMENT is the Trust Kernel's,
 * because a decision a plugin could substitute is not enforcement. Every call
 * here resolves the kernel through `ctx.get('trustKernel')` — pinned before
 * any entry mounts — and asks it to bind the decision, so a plugin that
 * replaced the policy service still cannot make an action permitted.
 *
 * Plugin contributions pass through `@deepseek-ai/dsh-policy-engine`'s
 * `composeDecision`, which is deny-only by type. Nothing registered here can
 * widen a decision.
 * @module @deepseek-ai/dsh-policy-enforcement
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import {
  composeDecision,
  decisionWhenUnavailable,
} from '@deepseek-ai/dsh-policy-engine'
export type { ClosedDecision } from '@deepseek-ai/dsh-policy-engine'
import type {
  ClosedDecision,
  PolicyConstraint,
  PolicyRequest,
  PolicySetDigest,
} from '@deepseek-ai/dsh-policy-engine'
import type { TrustKernel, TrustKernelPolicyQuery, TrustKernelPolicyVerdict } from '@deepseek-ai/dsh-trust-kernel'

/** What one enforced action records, and what an operator reads back. */
export interface PolicyAuditRecord {
  /** The action the decision was about. */
  readonly actionId: string
  /** The originator that started it (acceptance[0]'s five). */
  readonly origin: string
  /**
   * The decision the enforcement point acted on — the FINAL one, after the
   * kernel bound it.
   *
   * Written after the binding rather than before, because a record of a
   * decision that was then overridden describes an action that did not happen
   * (BLOCKED-194). A kernel override is exactly the case an operator most
   * needs the log for, and the earlier order made it the one case the log
   * could not show.
   */
  readonly decision: ClosedDecision
  /**
   * What the composition produced, present ONLY when the kernel overrode it.
   *
   * Absent on every ordinary decision, so its presence is the signal: this
   * refusal did not come from the engine or a constraint, it came from the
   * kernel vetoing what they allowed. Both halves are recorded because neither
   * alone explains the outcome — `decision` says what happened, this says what
   * the policy layer had decided before the veto.
   */
  readonly overrode?: ClosedDecision
  /** The matched policy ids — audit only, never model-visible (must[3]). */
  readonly matched: readonly string[]
  /** The engine's own diagnostics — audit only. */
  readonly diagnostics: readonly string[]
  /** Every plugin constraint that objected, in registration order. */
  readonly constraintReasons: readonly string[]
}

/**
 * The registry a plugin adds a constraint to (must[2]).
 *
 * A service rather than a bare array so a constraint disposes with its
 * plugin's fiber: a plugin that unmounts must stop constraining, and a
 * constraint that outlived its owner would be a policy nobody can find.
 */
export class PolicyConstraints extends Service {
  static readonly inject = []

  private readonly constraints = new Set<PolicyConstraint>()

  constructor(ctx: Context) {
    super(ctx, 'policyConstraints')
  }

  /**
   * Register one deny-only constraint.
   * @param constraint - returns a reason to deny, or undefined to abstain.
   * @returns the disposer that unregisters it.
   */
  register(constraint: PolicyConstraint): () => void {
    // The effect's own disposer may be asynchronous; a constraint's removal is
    // not, so the caller gets a synchronous one and the effect's promise is
    // deliberately not awaited — there is nothing after `delete` to order.
    const dispose = this.ctx.effect((): (() => void) => {
      this.constraints.add(constraint)
      return (): void => { this.constraints.delete(constraint) }
    })
    return (): void => { void dispose() }
  }

  /**
   * Every live constraint, for the enforcement point.
   * @returns the registered constraints, in registration order.
   */
  all(): readonly PolicyConstraint[] {
    return [...this.constraints]
  }
}

/**
 * The deployment's kernel policy decider: endorse a composed decision, add no
 * refusal of its own.
 *
 * Declared here because this is the one module that knows BOTH vocabularies —
 * `ClosedDecision.effect`'s three values and the kernel's verdict — and the
 * kernel package must not import policy types. A launcher wires it into
 * `createTrustKernel`; a test asserting the enforcement point's behaviour uses
 * the same symbol, so what is under test is the shipped decider rather than a
 * copy that happens to look alike.
 *
 * Without a decider the kernel denies EVERY query — the right default for an
 * entrypoint with no provider behind it, and why every tool call on a factory
 * profile came back `policy-unavailable` even once an engine was mounted
 * (BLOCKED-187).
 *
 * `ask` is endorsed, not refused. `PolicyEffect` is closed at three values and
 * {@link enforceAction} rewrites a kernel deny over a non-deny decision into
 * `policy-unavailable`, so refusing `ask` here would turn every "a human should
 * decide this" into "no policy service is available" — removing the
 * human-decision path and mislabelling it in text a model and a user both read.
 * **The kernel vetoes; it does not answer approval questions on a human's
 * behalf.**
 *
 * An unrecognizable payload is REFUSED: this is the one place the kernel's type
 * says `unknown` and the deployment supplies the meaning, which makes it a
 * boundary where a runtime check belongs.
 * @param query - the kernel policy query; its payload is the already-composed
 *   {@link ClosedDecision}.
 * @returns `allow` for a composed `permit` or `ask`, `deny` for anything else.
 */
export function endorseComposedDecision(query: TrustKernelPolicyQuery): TrustKernelPolicyVerdict {
  const payload: unknown = query.payload
  if (typeof payload !== 'object' || payload === null) return 'deny'
  const effect: unknown = (payload as { readonly effect?: unknown }).effect
  return effect === 'permit' || effect === 'ask' ? 'allow' : 'deny'
}

/**
 * Decide one action, bind the decision in the kernel, and record it.
 *
 * The order is the contract. The engine answers, the plugins may narrow, the
 * KERNEL binds, and the audit is appended before the caller acts — a record
 * written afterwards would be missing exactly when the process dies between
 * deciding and doing.
 *
 * When no policy service is mounted the decision is `policy-unavailable`, by
 * name. The provider is an ordinary plugin and may be unmounted mid-session;
 * what may not be lost is the enforcement, so the enforcement point answers
 * for itself rather than falling open (acceptance[2]).
 * @param ctx - the context the action is being executed in.
 * @param request - the five declared policy inputs.
 * @param origin - which originator started the action, for the audit.
 * @returns the closed decision the caller must act on.
 * @throws when no Trust Kernel is pinned: a harness that cannot enforce must
 *   not proceed as though it had.
 */
export function enforceAction(ctx: Context, request: PolicyRequest, origin: string): ClosedDecision {
  const kernel: TrustKernel | undefined = ctx.get('trustKernel')
  if (kernel === undefined) {
    throw new Error('policy enforcement requires a pinned Trust Kernel; this composition has none')
  }
  const engine = ctx.get('policy')
  const evaluation = engine === undefined
    ? {
      decision: decisionWhenUnavailable(lastKnownDigest(ctx)),
      explain: { matched: [], diagnostics: [] },
    }
    : engine.evaluate(request)
  if (engine !== undefined) rememberDigest(ctx, engine.digest)

  const composed = composeDecision(evaluation, ctx.get('policyConstraints')?.all() ?? [], request)

  // The kernel binds. A `deny` verdict overrides a decision that reached here
  // as a permit, because the kernel is the one participant a plugin cannot
  // replace; the reverse is not true, and a kernel `allow` never widens a
  // refusal the engine or a constraint already made.
  const verdict: TrustKernelPolicyVerdict = kernel.policyEnforcement({ payload: composed.decision })
  const overridden = verdict === 'deny' && composed.decision.effect !== 'deny'
  const decision: ClosedDecision = overridden
    ? { effect: 'deny', reason: 'policy-unavailable', policySet: composed.decision.policySet }
    : composed.decision

  // Appended AFTER the binding, and carrying the decision that was ENFORCED
  // (BLOCKED-194). The earlier order recorded what the policy layer decided
  // and then let the kernel change it unlogged, so the one refusal an operator
  // cannot otherwise explain — the kernel vetoing a permit — was written down
  // as a permit.
  const record: PolicyAuditRecord = {
    actionId: String(request.manifest.actionId),
    origin,
    decision,
    ...overridden ? { overrode: composed.decision } : {},
    matched: evaluation.explain.matched.map(id => String(id)),
    diagnostics: evaluation.explain.diagnostics,
    constraintReasons: composed.constraintReasons,
  }
  kernel.auditAppend({ payload: record })

  return decision
}

/**
 * The five originators acceptance[0] names, plus the manifest origin each
 * dispatch path already records.
 *
 * A closed set, because acceptance[0] is a claim about coverage: an open
 * string would let a sixth path arrive unnamed and still look enforced.
 */
export type ActionOriginator =
  /** A model-issued tool call, dispatched by the agent loop. */
  | 'native-tool-call'
  /** A tool call embedded in a code-mode program. */
  | 'code-mode-embedded'
  /** A delegated child agent's own dispatch. */
  | 'subagent'
  /** A workflow script's `agent()` call, detached or nested alike. */
  | 'workflow'
  /** An out-of-process SDK client's dispatch. */
  | 'sdk-rpc'
  /** A plugin's own RPC dispatch. */
  | 'plugin-rpc'

/**
 * Decide one already-manifested action (acceptance[0]).
 *
 * The manifest is the policy question, which is why this is called where a
 * manifest exists rather than where a tool name does: every originator that
 * reaches a tool has produced one through `appendManifestThenGate`, so a path
 * that skipped this call is a path that also skipped the manifest, and P2-03's
 * `assertManifestPrecedesExecution` already refuses that.
 *
 * **The caller supplies the facts, and the type makes it say so.** They were
 * optional here and defaulted in place until BLOCKED-201, and the measurement
 * that closed it was that NO dispatch path passed any: every policy question a
 * shipped composition ever asked carried the fail-closed values, so a rule
 * about workspace trust or action risk could not match however it was written.
 * A field a path may omit is a field every path eventually omits, so the
 * defaulting moved out to `readPolicyContextFacts`, where an absent service is
 * a decision with one home rather than a `??` at the point of use.
 * @param ctx - the context the action executes in.
 * @param input - the manifest, the identity's token, the originator and the facts.
 * @returns the closed decision the caller must act on.
 */
export function enforceManifestedAction(ctx: Context, input: EnforcementInput): ClosedDecision {
  return enforceAction(ctx, {
    identity: input.manifest.actor,
    token: input.token,
    manifest: input.manifest,
    world: { kind: 'absent' },
    facts: input.facts,
  }, input.origin)
}

/** What a dispatch path supplies to {@link enforceManifestedAction}. */
export interface EnforcementInput {
  /** The manifest the path just appended. */
  readonly manifest: PolicyRequest['manifest']
  /** The capability token presented with the action, when the deployment issues them. */
  readonly token: PolicyRequest['token']
  /** Which originator is dispatching. */
  readonly origin: ActionOriginator
  /**
   * The context facts, as the dispatch path read them from the composition.
   *
   * Required, not optional: see {@link enforceManifestedAction}.
   * `@deepseek-ai/dsh-tools/external-effect`'s `readPolicyContextFacts` is the
   * one reader both shipped paths use.
   */
  readonly facts: PolicyRequest['facts']
}

/**
 * The policy-set digest last seen in this context.
 *
 * Kept so a refusal made after the provider disappeared still names WHICH set
 * it could not reach: a replay comparing digests can then tell "the engine was
 * gone" from "the engine said no", which is the distinction acceptance[1]
 * rests on.
 */
const LAST_KNOWN = new WeakMap<object, PolicySetDigest>()

/** Remember the digest of the set currently mounted. */
function rememberDigest(ctx: Context, digest: PolicySetDigest): void {
  LAST_KNOWN.set(ctx.root, digest)
}

/** The digest last seen, or undefined when no engine was ever mounted here. */
function lastKnownDigest(ctx: Context): PolicySetDigest | undefined {
  return LAST_KNOWN.get(ctx.root)
}

/** Cordis plugin name. */
export const name = 'policy-enforcement'

/**
 * Mount the constraint registry.
 * @param ctx - the mounting context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(PolicyConstraints)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    policyConstraints: PolicyConstraints
  }
}
