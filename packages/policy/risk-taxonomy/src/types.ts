/**
 * Pure types of the risk taxonomy: the eight risk classes P2-04's must[0]
 * fixes, the organisation policy that decides which class an action lands in,
 * and the classification result carrying confidence and grounds (must[2]).
 *
 * **This is a THIRD side-effect vocabulary in this repository, and that is
 * deliberate.** `@deepseek-ai/dsh-plugin-manifest`'s `SideEffectClass` and
 * `@deepseek-ai/dsh-action-manifest`'s `ActionSideEffectClass` both classify
 * MECHANISM — what an operation touches (`read`, `write`, `network`,
 * `process`). These eight classify RISK — what it costs when the operation is
 * wrong. A financial transfer and a `rm -rf` are both `process` under the
 * mechanism taxonomies and are `financial` and `destructive` here.
 *
 * The two vocabularies share the spellings `read` and `destructive` with
 * different meanings, so a mapping between them is never an identity: it must
 * be total and monotone, or a plugin could pick a mechanism tag to obtain a
 * lower risk band and defeat acceptance[1]. That mapping is not declared here
 * — it belongs with `ActionSideEffectClass`, whose file P2-03 owns.
 *
 * @module @deepseek-ai/dsh-risk-taxonomy/types
 */

/**
 * The eight risk classes (must[0]).
 *
 * Names are the clause's own, not paraphrases. `local-reversible` is an
 * effect the actor can undo without another party; `internal-write` reaches
 * durable state inside the trust boundary; `external-communication` leaves it.
 */
export type RiskClass =
  | 'read'
  | 'local-reversible'
  | 'internal-write'
  | 'external-communication'
  | 'destructive'
  | 'financial'
  | 'security-sensitive'
  | 'safety-critical'

/**
 * Why a classification reached the class it did (must[2]'s "依据").
 *
 * `policy-rule` — an organisation rule matched the action's declared domain
 * tag. `kernel-hard-deny` — the action fell in a class the kernel refuses
 * regardless of organisation policy (acceptance[2]). `unknown-default` — no
 * rule matched, so must[3]'s highest-risk default applied. The three are
 * distinguished because "classified as safety-critical by a rule" and
 * "classified as safety-critical because nothing matched" carry different
 * information for an operator, and collapsing them hides which of the two
 * happened.
 */
export type RiskGroundKind = 'policy-rule' | 'kernel-hard-deny' | 'unknown-default'

/**
 * What an action states about itself, before any policy runs.
 *
 * A plugin declares `domainTags`; it does NOT declare a class. must[1] gives
 * the mapping to organisation policy, so this type deliberately has no field
 * a plugin could use to assert its own risk band.
 */
export interface ActionRiskSubject {
  /** Stable identifier of the action being classified. */
  readonly actionId: string
  /** Domain tags the plugin declares; inputs to classification, never verdicts. */
  readonly domainTags: readonly string[]
}

/** One organisation rule: a domain tag, and the class the organisation assigns it. */
export interface RiskPolicyRule {
  /** The declared domain tag this rule decides. */
  readonly domainTag: string
  /** The risk class the organisation assigns to that tag. */
  readonly riskClass: RiskClass
}

/**
 * An organisation's classification policy (must[1], acceptance[2]).
 *
 * The two hard-deny fields are separate on purpose. `addedHardDenyClasses`
 * is an organisation raising its own bar, which acceptance[2] permits.
 * `removedHardDenyClasses` exists ONLY so that switching a hard deny off is
 * something a policy can actually SAY — and therefore something `classify`
 * can refuse. Folding both into one list would leave the refusal with no
 * subject: omission would be indistinguishable from "added nothing", and the
 * acceptance[2] check would pass by never being reachable.
 */
export interface RiskPolicy {
  /** Tag-to-class assignments this organisation makes. */
  readonly rules: readonly RiskPolicyRule[]
  /** Classes this organisation refuses outright beyond the kernel's own. */
  readonly addedHardDenyClasses?: readonly RiskClass[]
  /** Kernel hard-deny classes this organisation attempts to switch off; always refused. */
  readonly removedHardDenyClasses?: readonly RiskClass[]
}

/**
 * The result of classifying one action (must[2]).
 *
 * `confidence` is 1 only when a rule decided the class; the unknown default
 * reports 0, because must[3]'s escalation is a safety decision rather than a
 * measurement, and reporting it as certain would misstate what is known.
 */
export interface RiskClassification {
  /** The class the action is classified into. */
  readonly riskClass: RiskClass
  /** How the class was reached. */
  readonly ground: RiskGroundKind
  /** The domain tag that decided it, or `undefined` under the unknown default. */
  readonly decidedBy: string | undefined
  /** 1 when a rule decided the class, 0 when the unknown default applied. */
  readonly confidence: number
  /** Whether this class is refused outright under the policy in force. */
  readonly hardDenied: boolean
}
