export type SubagentRequestStatus = 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SubagentRequest {
  readonly id: string
  readonly parentId: string
  readonly runId: string
  readonly taskDescription: string
  readonly objective: string
  readonly constraints: readonly string[]
  readonly capabilityTokenDigest: string
  readonly budgetAllocation: {
    readonly maxTokens: number
    readonly maxCost: number
    readonly maxTimeMs: number
    readonly maxAgents: number
  }
  readonly worldId: string
  readonly requiredTools: readonly string[]
  readonly verificationContractRef?: string
  readonly priority: number
  readonly deadline: number
  readonly traceId: string
  readonly status: SubagentRequestStatus
}

export interface SubagentRequestValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
}

export function validateSubagentRequest(req: SubagentRequest): SubagentRequestValidation {
  const errors: string[] = []
  if (!req.id) errors.push('id is required')
  if (!req.parentId) errors.push('parentId is required')
  if (!req.runId) errors.push('runId is required')
  if (!req.taskDescription) errors.push('taskDescription is required')
  if (!req.objective) errors.push('objective is required')
  if (!req.capabilityTokenDigest) errors.push('capabilityTokenDigest is required')
  if (req.budgetAllocation.maxTokens <= 0) errors.push('maxTokens must be positive')
  if (req.budgetAllocation.maxAgents <= 0) errors.push('maxAgents must be positive')
  if (req.budgetAllocation.maxTimeMs <= 0) errors.push('maxTimeMs must be positive')
  if (!req.worldId) errors.push('worldId is required')
  if (req.requiredTools.length === 0) errors.push('at least one requiredTool is needed')
  if (req.deadline <= 0) errors.push('deadline must be positive')
  if (!req.traceId) errors.push('traceId is required')
  // Budget cannot exceed parent (would be checked against parent in runtime)
  return { valid: errors.length === 0, errors }
}

export function attenuateBudget(
  parentBudget: { maxTokens: number; maxCost: number; maxTimeMs: number; maxAgents: number },
  childRequest: { maxTokens: number; maxCost: number; maxTimeMs: number; maxAgents: number },
): { attenuated: boolean; budget: typeof parentBudget } {
  const attenuated = {
    maxTokens: Math.min(parentBudget.maxTokens, childRequest.maxTokens),
    maxCost: Math.min(parentBudget.maxCost, childRequest.maxCost),
    maxTimeMs: Math.min(parentBudget.maxTimeMs, childRequest.maxTimeMs),
    maxAgents: Math.min(parentBudget.maxAgents, childRequest.maxAgents),
  }
  const wasAttenuated =
    attenuated.maxTokens !== childRequest.maxTokens ||
    attenuated.maxCost !== childRequest.maxCost ||
    attenuated.maxTimeMs !== childRequest.maxTimeMs ||
    attenuated.maxAgents !== childRequest.maxAgents
  return { attenuated: wasAttenuated, budget: attenuated }
}
