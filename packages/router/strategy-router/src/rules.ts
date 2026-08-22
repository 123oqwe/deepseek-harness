import type { RoutingContext, RoutingDecision } from './types.ts'

export function evaluateRules(ctx: RoutingContext): RoutingDecision {
  // Multi-agent: requires multiple agents and complex task
  if (ctx.requiresMultipleAgents && ctx.taskComplexity === 'multi-step') {
    return {
      strategy: 'multi-agent',
      reason: 'Multi-step task requiring multiple agents',
      confidence: 0.9,
      fallbackStrategy: 'workflow',
    }
  }

  // Workflow: complex multi-step with external side effects
  if (ctx.taskComplexity === 'complex' && ctx.estimatedSteps > 5 && ctx.hasExternalSideEffects) {
    return {
      strategy: 'workflow',
      reason: 'Complex task with side effects and many steps',
      confidence: 0.85,
      fallbackStrategy: 'plan',
    }
  }

  // Plan: moderate complexity requiring planning
  if (ctx.requiresPlanning && (ctx.taskComplexity === 'moderate' || ctx.taskComplexity === 'complex')) {
    return {
      strategy: 'plan',
      reason: 'Task requires planning before execution',
      confidence: 0.8,
      fallbackStrategy: 'react',
    }
  }

  // ReAct: requires tools and some complexity
  if (ctx.requiresTools && ctx.taskComplexity !== 'simple') {
    return {
      strategy: 'react',
      reason: 'Tool-using task with moderate complexity',
      confidence: 0.75,
      fallbackStrategy: 'direct',
    }
  }

  // Direct: simple tasks
  return {
    strategy: 'direct',
    reason: 'Simple task, direct execution',
    confidence: 0.7,
  }
}
