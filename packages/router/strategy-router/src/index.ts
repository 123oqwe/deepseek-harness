import type { RoutingContext, RoutingDecision } from './types.ts'
import { evaluateRules } from './rules.ts'

export type { RoutingContext, RoutingDecision, Strategy } from './types.ts'
export { evaluateRules } from './rules.ts'

export class StrategyRouter {
  private readonly shadowLog: { input: RoutingContext; decision: RoutingDecision; timestamp: number }[] = []

  route(ctx: RoutingContext): RoutingDecision {
    const decision = evaluateRules(ctx)

    // In shadow mode, log but don't change behavior
    if (ctx.featureGate === 'shadow') {
      this.shadowLog.push({ input: ctx, decision, timestamp: Date.now() })
    }

    return decision
  }

  getShadowLog(): readonly { input: RoutingContext; decision: RoutingDecision; timestamp: number }[] {
    return this.shadowLog
  }

  // For testing: same input always produces same decision (deterministic)
  isDeterministic(ctx: RoutingContext): boolean {
    const d1 = evaluateRules(ctx)
    const d2 = evaluateRules(ctx)
    return d1.strategy === d2.strategy && d1.confidence === d2.confidence
  }
}
