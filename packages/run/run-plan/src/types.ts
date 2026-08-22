export interface ModelRoute {
  readonly provider: string
  readonly model: string
  readonly fallbackProvider?: string
  readonly fallbackModel?: string
}

export interface AgentNode {
  readonly id: string
  readonly role: string
  readonly modelRoute: ModelRoute
  readonly tools: string[]
  readonly worldId: string
}

export interface WorldSpec {
  readonly id: string
  readonly kind: 'local' | 'container' | 'remote'
  readonly policyDigest: string
}

export interface BudgetAllocation {
  readonly tokens: number
  readonly cost: number
  readonly time: number
  readonly agents: number
}

export interface ApprovalGate {
  readonly stepId: string
  readonly approver: string
  readonly deadline: string
}

export interface VerificationSpec {
  readonly method: string
  readonly criteria: string[]
  readonly verifier: string
}

export interface RunPlan {
  readonly id: string
  readonly objectives: string[]
  readonly constraints: string[]
  readonly modelRoutes: ModelRoute[]
  readonly contextTopology: string
  readonly agentGraph: AgentNode[]
  readonly worlds: WorldSpec[]
  readonly budgets: BudgetAllocation[]
  readonly approvalGates: ApprovalGate[]
  readonly verification: VerificationSpec
  readonly recovery: { readonly maxRetries: number; readonly checkpoint: boolean }
  readonly digest: string
}
