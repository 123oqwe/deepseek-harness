import type { PolicyRule, PolicyContext, PolicyResult, PolicyDecision } from './types.ts'
import { MonotonicDenyViolation } from './types.ts'

const rules: PolicyRule[] = []
const deniedCapabilities = new Set<string>()

export function addRule(rule: PolicyRule): void {
  if (rule.source === 'kernel' && rule.decision === 'deny') {
    deniedCapabilities.add(rule.capability)
  }
  if (rule.decision === 'deny' && deniedCapabilities.has(rule.capability) && rule.source !== 'kernel') {
    // Plugins cannot override a kernel deny
    if (rule.decision === 'allow') {
      throw new MonotonicDenyViolation(rule.id)
    }
  }
  rules.push(rule)
  rules.sort((a, b) => b.priority - a.priority)
}

export function evaluate(ctx: PolicyContext): PolicyResult {
  // Check kernel-level deny first (monotonic)
  if (deniedCapabilities.has(ctx.capability)) {
    return {
      decision: 'deny' as PolicyDecision,
      reason: `kernel-level monotonic deny for ${ctx.capability}`,
      source: 'kernel',
      ruleId: 'kernel-deny',
      monotonic: true,
    }
  }

  // Evaluate rules by priority (highest first)
  for (const rule of rules) {
    if (rule.capability !== ctx.capability && rule.capability !== '*') continue
    if (rule.condition && !rule.condition(ctx)) continue

    if (rule.decision === 'deny') {
      // Deny is sticky: once denied by a rule, no lower-priority allow can override
      return {
        decision: 'deny',
        reason: rule.reason,
        source: rule.source,
        ruleId: rule.id,
        monotonic: rule.source === 'kernel',
      }
    }
    if (rule.decision === 'allow') {
      return {
        decision: 'allow',
        reason: rule.reason,
        source: rule.source,
        ruleId: rule.id,
        monotonic: false,
      }
    }
  }

  return {
    decision: 'deny',
    reason: 'no matching rule (default deny)',
    source: 'default',
    ruleId: 'default-deny',
    monotonic: false,
  }
}

export function clearRules(): void {
  rules.length = 0
  deniedCapabilities.clear()
}

export function getRules(): PolicyRule[] {
  return [...rules]
}
