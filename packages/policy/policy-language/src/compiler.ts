import type { PolicyExpr } from './parser.ts'

export interface CompiledRule {
  readonly id: string
  readonly expr: PolicyExpr
  readonly priority: number
}

export interface ExplainResult {
  readonly decision: 'allow' | 'deny' | 'require-approval' | 'no-match'
  readonly matchedRule?: CompiledRule
  readonly reason: string
  readonly trace: string[]
}

export function compileRules(exprs: PolicyExpr[]): CompiledRule[] {
  return exprs.map((expr, i) => ({
    id: `rule-${i}`,
    expr,
    priority: expr.type === 'deny' ? 100 - i : 50 - i,
  }))
}

export function evaluate(ctx: { capability: string }, rules: CompiledRule[]): ExplainResult {
  const trace: string[] = []
  for (const rule of rules.sort((a, b) => b.priority - a.priority)) {
    trace.push(`checking ${rule.id} (${rule.expr.type}) for ${rule.expr.capability}`)
    if (rule.expr.capability !== '*' && rule.expr.capability !== ctx.capability) {
      trace.push(`  skipped: capability mismatch`)
      continue
    }
    switch (rule.expr.type) {
      case 'deny':
        return { decision: 'deny', matchedRule: rule, reason: rule.expr.reason, trace }
      case 'allow':
        return { decision: 'allow', matchedRule: rule, reason: 'allowed', trace }
      case 'require-approval':
        return { decision: 'require-approval', matchedRule: rule, reason: `requires approval from ${rule.expr.approver}`, trace }
      case 'limit':
        return { decision: 'allow', matchedRule: rule, reason: `limited to ${rule.expr.maxActions} actions per ${rule.expr.window}s`, trace }
    }
  }
  return { decision: 'no-match', reason: 'no matching rule (default deny)', trace }
}

export function dryRun(ctx: { capability: string }, rules: CompiledRule[]): ExplainResult {
  return evaluate(ctx, rules)
}
