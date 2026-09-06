/**
 * The pure risk classifier (P2-04 must[1], must[2], must[3], acceptance[1],
 * acceptance[2]).
 *
 * Pure and total: no I/O, no clock, no ambient policy. The organisation
 * policy is a parameter, so the same action classified under two policies
 * gives two answers and neither is a property of this module.
 *
 * @module @deepseek-ai/dsh-risk-taxonomy/classify
 */
import type { ActionRiskSubject, RiskClass, RiskClassification, RiskPolicy } from './types.ts'

/**
 * The eight classes in ascending risk order (must[0]).
 *
 * The order is the one every comparison in this module uses, so "highest
 * risk" has exactly one meaning: a composite action takes the maximum under
 * this array, and `SAFETY_CRITICAL` being last is what makes must[3]'s
 * unknown-default the highest class rather than merely a high one.
 */
export const RISK_CLASSES_BY_ASCENDING_RISK: readonly RiskClass[] = Object.freeze([
  'read',
  'local-reversible',
  'internal-write',
  'external-communication',
  'destructive',
  'financial',
  'security-sensitive',
  'safety-critical',
])

/**
 * The classes the kernel refuses outright, which no organisation policy may
 * remove (acceptance[2]).
 */
export const KERNEL_HARD_DENY_CLASSES: readonly RiskClass[] = Object.freeze(['safety-critical'])

/** The class an action lands in when no rule matches it (must[3]). */
const UNKNOWN_DEFAULT_CLASS: RiskClass = 'safety-critical'

/**
 * Rank of a class in the ascending risk order.
 * @param riskClass - the class to rank.
 * @returns its index in {@link RISK_CLASSES_BY_ASCENDING_RISK}.
 */
export function riskRank(riskClass: RiskClass): number {
  return RISK_CLASSES_BY_ASCENDING_RISK.indexOf(riskClass)
}

/**
 * Classify one action under one organisation policy.
 *
 * Every tag the action declares is looked up, and the HIGHEST class any rule
 * assigns wins (must[3]'s "取最高" for a composite subject, and acceptance[1]:
 * a plugin adding a low-risk tag beside a high-risk one cannot lower the
 * result, because the maximum ignores the addition).
 *
 * A tag no rule mentions contributes nothing rather than defaulting on its
 * own; the unknown default applies only when NO tag matched at all, so one
 * unrecognised tag beside a matched one does not silently escalate an
 * otherwise decided action to `safety-critical`.
 * @param subject - the action and the domain tags it declares.
 * @param policy - the organisation policy in force.
 * @returns the class, how it was reached, and whether it is refused outright.
 * @throws {RangeError} when the policy tries to remove a kernel hard-deny class.
 */
export function classify(subject: ActionRiskSubject, policy: RiskPolicy): RiskClassification {
  assertPolicyKeepsKernelHardDenies(policy)

  let decided: { riskClass: RiskClass; domainTag: string } | undefined
  for (const tag of subject.domainTags) {
    for (const rule of policy.rules) {
      if (rule.domainTag !== tag) continue
      if (decided === undefined || riskRank(rule.riskClass) > riskRank(decided.riskClass)) {
        decided = { riskClass: rule.riskClass, domainTag: tag }
      }
    }
  }

  const riskClass = decided?.riskClass ?? UNKNOWN_DEFAULT_CLASS
  const hardDenied = hardDenyClassesOf(policy).includes(riskClass)
  return {
    riskClass,
    ground: decided === undefined ? 'unknown-default' : hardDenied ? 'kernel-hard-deny' : 'policy-rule',
    decidedBy: decided?.domainTag,
    // The unknown default is a safety decision, not a measurement: reporting
    // it as certain would let a reader treat an unclassifiable action and a
    // ruled one as equally well understood.
    confidence: decided === undefined ? 0 : 1,
    hardDenied,
  }
}

/**
 * The classes refused outright under `policy`: the kernel's, plus the
 * organisation's own additions.
 * @param policy - the organisation policy in force.
 * @returns the effective hard-deny class list.
 */
function hardDenyClassesOf(policy: RiskPolicy): readonly RiskClass[] {
  return [...KERNEL_HARD_DENY_CLASSES, ...policy.addedHardDenyClasses ?? []]
}

/**
 * Refuse a policy that drops a kernel hard-deny class (acceptance[2]).
 *
 * Refused rather than silently re-added: an organisation that believes it has
 * switched off a hard deny must fail loudly at the point it says so, not
 * discover at enforcement time that its configuration meant something else.
 * A removal naming a class the kernel does NOT pin is not refused here — it
 * removes nothing, because the kernel list is the only floor.
 * @param policy - the organisation policy to validate.
 * @throws {RangeError} naming the class the policy tried to remove.
 */
function assertPolicyKeepsKernelHardDenies(policy: RiskPolicy): void {
  for (const removed of policy.removedHardDenyClasses ?? []) {
    if (KERNEL_HARD_DENY_CLASSES.includes(removed)) {
      throw new RangeError(
        `organisation policy switches off the kernel hard-deny class "${removed}": an organisation may raise its own threshold but may not remove one the kernel pins`,
      )
    }
  }
}
