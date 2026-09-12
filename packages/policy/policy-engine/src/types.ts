/**
 * The policy decision vocabulary Epic P2-05 declares: what a policy request
 * carries, what a closed decision is, and what a plugin may contribute to one.
 *
 * Types only, and deliberately engine-free. The Cedar provider is a separate
 * package (`@deepseek-ai/dsh-policy-engine-cedar`), because a composition rule
 * that could only be stated with an engine mounted would be a claim about that
 * engine rather than about the harness.
 * @module @deepseek-ai/dsh-policy-engine/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Principal } from '@deepseek-ai/dsh-principal'
import type { ActionManifest } from '@deepseek-ai/dsh-action-manifest'
import type { CapabilityTokenLogRecord } from '@deepseek-ai/dsh-capability-token'
import type { WorldId, WorldProviderId, WorldSpecDigest } from '@deepseek-ai/dsh-execution-world/types'

/**
 * Digest of the policy SET a decision was made against.
 *
 * Recorded on every decision because a replay that cannot tell "the policy
 * changed" from "the decision changed" proves nothing: acceptance[1]'s replay
 * compares this digest first, and a differing one means the two runs answered
 * different questions rather than the same question differently.
 */
export type PolicySetDigest = Branded<'PolicySetDigest'>

/** Stable identifier of one policy within a set, as an explain trace names it. */
export type PolicyId = Branded<'PolicyId'>

/**
 * How much the workspace this action runs in is trusted (must[0]'s "context
 * facts", first half).
 *
 * A closed enumeration mirroring `@deepseek-ai/dsh-workspace-trust`'s own
 * `TrustState`, not a re-derivation: P1-07 decides what a workspace's trust IS,
 * and this vocabulary only states which of those values a policy may read. A
 * fact this layer invented would be a second trust model.
 */
export type WorkspaceTrustFact = 'untrusted' | 'trusted-read' | 'trusted-execute'

/**
 * The permission posture the session is running under (must[0]'s "context
 * facts", second half).
 *
 * Named by the preset the deployment selected, as a closed set rather than a
 * free string: a policy that could match an arbitrary preset name would make
 * adding a preset a silent policy change.
 */
export type PermissionPostureFact = 'default' | 'plan' | 'accept-edits' | 'bypass'

/**
 * How risky the action itself is, as the deployment's risk policy classified
 * it (must[0]'s "context facts", third half).
 *
 * A closed enumeration mirroring `@deepseek-ai/dsh-risk-taxonomy`'s own
 * `RiskClass`, declared here for the same reason {@link WorkspaceTrustFact} is:
 * P2-04 decides what an action's class IS, and this vocabulary only states
 * which of those values a policy may read.
 *
 * The dispatch paths classify BEFORE asking policy so this carries the real
 * verdict. Until BLOCKED-201 no caller passed facts at all, so every policy
 * saw a fail-closed default and no rule about risk could ever match.
 */
export type ActionRiskClassFact =
  | 'read'
  | 'local-reversible'
  | 'internal-write'
  | 'external-communication'
  | 'destructive'
  | 'financial'
  | 'security-sensitive'
  | 'safety-critical'

/** The context facts a policy may read, all of them declared. */
export interface PolicyContextFacts {
  /** The workspace's trust state. */
  readonly workspaceTrust: WorkspaceTrustFact
  /** The session's permission posture. */
  readonly permissionPosture: PermissionPostureFact
  /** The class the deployment's risk policy put this action in. */
  readonly riskClass: ActionRiskClassFact
}

/**
 * The world an action executes in (must[0]'s fifth input).
 *
 * Two variants, and the pair is what makes the input decidable. `absent` is a
 * value a policy can match on, NOT a missing field: a policy that must know the
 * world can refuse when the world is unknown, which is different from a policy
 * that never asked. `bound` carries the identity of the world the action will
 * run in, so a rule can distinguish one confinement from another.
 *
 * Until P3-01's Usage stage this type had only `absent`, which made P3-01
 * acceptance[1] ("fail closed when no provider satisfies policy") unprovable
 * from the policy side: with one variant there was nothing for a rule to refuse
 * on, so every rule about where an action runs matched everything or nothing.
 *
 * The world is named by its ids and its confinement digest, never by a
 * `WorldHandle`. A handle is an unforgeable capability (P3-01 acceptance[2]);
 * putting one in a policy request would hand the authority to operate a world
 * to every engine that reads the request, and a Cedar context cannot carry an
 * object identity anyway.
 *
 * Recorded as BLOCKED-178 under §12.46-B: this epic owns the rule half, P3-01
 * owns the producer.
 */
export type ExecutionWorldFact
  = { readonly kind: 'absent' }
    | {
      readonly kind: 'bound'
      /** The world the action will run in. */
      readonly world: WorldId
      /** The provider that minted it, so a provider swap is visible to a rule. */
      readonly provider: WorldProviderId
      /** Digest of the `WorldSpec` the world was created from; what a rule compares confinement by. */
      readonly spec: WorldSpecDigest
    }

/**
 * What a policy may read about the capability token presented with an action
 * (must[0]'s second input).
 *
 * The token's CLAIMS and its digest, never the token itself — this is
 * `redactTokenForLog`'s projection, which P2-02 already audited as the form
 * safe to carry outside the token layer. A policy engine holding the signed
 * token would hold an authority it could pass on, and a second redaction
 * shaped for policy would be a second thing to keep in step with P2-02.
 */
export type PolicyTokenFacts = CapabilityTokenLogRecord

/**
 * One policy question (must[0]).
 *
 * All five inputs are REQUIRED, including `world` in its absent form. An
 * optional field would let a caller omit an input and receive a decision
 * anyway, which is how a policy engine silently starts answering a smaller
 * question than the one it documents.
 */
export interface PolicyRequest {
  /** Who is acting (P2-01). */
  readonly identity: Principal
  /** The authority presented for the action (P2-02), absent when the deployment mounts none. */
  readonly token: PolicyTokenFacts | undefined
  /** What is being attempted (P2-03). */
  readonly manifest: ActionManifest
  /** Where it would run (P3-01), `absent` when no world registry is mounted. */
  readonly world: ExecutionWorldFact
  /** The declared facts a policy may read. */
  readonly facts: PolicyContextFacts
}

/**
 * Why a decision came out the way it did, in terms a model and an ordinary
 * plugin may see (must[3]).
 *
 * A CLOSED set, because it crosses to the model. A free-text reason would let
 * a policy's own wording — which may name a rule, a tenant, or a path — reach a
 * request, which is exactly what must[3] separates from the audit trail.
 */
export type PolicyReasonCode =
  /** No policy in the set permitted the action, and the default is deny. */
  | 'no-matching-permit'
  /** A policy forbade it, and a forbid is final. */
  | 'forbidden-by-policy'
  /** A plugin added a constraint the action did not satisfy. */
  | 'constrained-by-plugin'
  /** The action needs a human answer before it may proceed. */
  | 'approval-required'
  /** The policy provider is not mounted, or was unmounted mid-session. */
  | 'policy-unavailable'
  /**
   * The configured policy set could not be read.
   *
   * Distinct from `policy-unavailable` (no engine at all) and from a policy
   * refusal (an engine that answered): a deployment whose policies do not
   * parse is broken, and collapsing it into a deny would make a broken
   * deployment indistinguishable from a strict one — including to the replay
   * acceptance[1] performs.
   */
  | 'policy-set-invalid'
  /** The request did not carry an authority the policy set requires. */
  | 'missing-capability-token'

/**
 * The decision set, closed (must[1]).
 *
 * `ask` is a policy outcome, never a softened deny: a plugin cannot turn a
 * `deny` into an `ask`, and a policy that wants a human answer says so itself.
 * The three values are what the enforcement point acts on, so an open union
 * would leave a caller with a case it has no behaviour for.
 */
export type PolicyEffect = 'permit' | 'deny' | 'ask'

/** One decision, closed and self-contained. */
export interface ClosedDecision {
  /** What the enforcement point must do. */
  readonly effect: PolicyEffect
  /** Why, in model-visible terms; absent only for a plain `permit`. */
  readonly reason?: PolicyReasonCode
  /** The policy set this was decided against (acceptance[1]'s replay key). */
  readonly policySet: PolicySetDigest
}

/**
 * What an engine reports about a decision, for the audit trail ONLY (must[3]).
 *
 * Never returned to a model or an ordinary plugin: the matched policy ids and
 * the engine's own diagnostics can name rules, tenants and paths. The
 * enforcement point appends this and hands back the {@link ClosedDecision}.
 */
export interface PolicyExplain {
  /** The policies that matched, in the engine's own order. */
  readonly matched: readonly PolicyId[]
  /** The engine's diagnostics, verbatim, for an operator reading the audit. */
  readonly diagnostics: readonly string[]
}

/** One engine answer: the decision, plus what only the audit may see. */
export interface PolicyEvaluation {
  /** The decision the enforcement point acts on. */
  readonly decision: ClosedDecision
  /** The audit-only detail. */
  readonly explain: PolicyExplain
}

/**
 * What a plugin may contribute to a decision (must[2]).
 *
 * Deny-only by TYPE, which is the whole point: a plugin returns a reason to
 * deny or nothing at all, and there is no shape in which it can return a
 * permit. `@deepseek-ai/dsh-tools`'s `ToolGuard` uses the same construction for
 * the same reason — a contribution that COULD widen would make the composition
 * order-dependent, and this epic's clause is that it is not.
 *
 * An `ask` is likewise unreachable from here. A plugin that wants a human in
 * the loop is asking to add a condition, not to relax one; letting it convert a
 * `deny` into an `ask` would turn a refusal into a prompt the user can wave
 * through.
 *
 * Throwing is a deny too, and is the constraint's own: the exception is caught
 * where constraints are composed, rendered as a reason naming this function and
 * carrying the message, and folded in like any other refusal. So a constraint
 * cannot widen a decision by failing, and cannot escape the enforcement point
 * either.
 * @param request - the same request the policy engine answered.
 * @returns a reason to deny, or `undefined` to leave the decision unchanged.
 */
export type PolicyConstraint = (request: PolicyRequest) => string | undefined

/**
 * What a mounted policy provider answers, whichever engine a profile mounts.
 *
 * Declared in the DEFINITION so the name means the contract rather than one
 * implementation, and two providers cannot disagree about what `ctx.policy`
 * is. The Cedar provider is `@deepseek-ai/dsh-policy-engine-cedar`.
 */
export interface PolicyEngineContract {
  /** The digest of the policy set this engine loaded; every decision carries it. */
  readonly digest: PolicySetDigest
  /**
   * Answer one policy question.
   * @param request - the five declared inputs.
   * @returns the closed decision the enforcement point acts on, plus the
   *   audit-only explain it appends.
   */
  evaluate(request: PolicyRequest): PolicyEvaluation
}

/**
 * The policy set in force right now, and the pin it was accepted under.
 *
 * A MAP from policy id to source rather than one concatenated string: submitted
 * as a string, an engine assigns generated ids and an `@id(...)` annotation does
 * not become the id the explain reports, so an audit trail built on the string
 * form would name policies nobody wrote. must[3]'s audit is only as good as
 * these ids.
 */
export interface CurrentPolicySet {
  /** Policy id to policy source, in the engine's own language. */
  readonly policies: Readonly<Record<string, string>>
  /** The digest every decision against this set records. */
  readonly digest: PolicySetDigest
}

/**
 * Where an engine gets the set it enforces (Epic P2-10's Usage stage).
 *
 * Declared HERE, in the definition, rather than on either side of the seam: the
 * provider that resolves a deployment's policy set and the engine that decides
 * against it must agree on what "the set in force" means, and neither of them
 * owning the word is what keeps a second provider from meaning something else
 * by it.
 *
 * **`current()` is asked per decision, and returns the set and its digest
 * together.** Both halves matter. Per decision, because the set changes under a
 * running harness — a deployment edits it and the provider re-resolves.
 * Together, because a digest fetched separately can describe a set the provider
 * is no longer yielding: before this seam an engine re-read its policies per
 * call while its digest was computed once at construction, so a reload moved the
 * enforced rules and left every decision citing a set no longer in force.
 */
export interface PolicySetProviderContract {
  /**
   * The set to decide against, and the pin to record with the decision.
   * @returns the policy set in force at this instant.
   */
  current(): CurrentPolicySet
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    policy: PolicyEngineContract
    policySet: PolicySetProviderContract
  }
}
