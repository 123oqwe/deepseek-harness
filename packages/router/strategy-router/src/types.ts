export type Strategy = 'direct' | 'react' | 'plan' | 'workflow' | 'multi-agent'

export interface RoutingContext {
  readonly taskComplexity: 'simple' | 'moderate' | 'complex' | 'multi-step'
  readonly requiresTools: boolean
  readonly requiresPlanning: boolean
  readonly requiresMultipleAgents: boolean
  readonly estimatedSteps: number
  readonly hasExternalSideEffects: boolean
  readonly featureGate: 'off' | 'shadow' | 'enforce'
}

export interface RoutingDecision {
  readonly strategy: Strategy
  readonly reason: string
  readonly confidence: number
  readonly fallbackStrategy?: Strategy
}
