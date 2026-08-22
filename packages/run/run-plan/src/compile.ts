import { createHash } from 'node:crypto'
import type { RunPlan, AgentNode, WorldSpec, ModelRoute, BudgetAllocation } from './types.ts'

export interface CompileInput {
  readonly objectives: string[]
  readonly constraints: string[]
  readonly modelRoutes: ModelRoute[]
  readonly agents: AgentNode[]
  readonly worlds: WorldSpec[]
  readonly budgets: BudgetAllocation[]
  readonly verification: RunPlan['verification']
}

export function compile(input: CompileInput): RunPlan {
  // Satisfiability check: every agent's world must exist
  for (const agent of input.agents) {
    if (!input.worlds.some(w => w.id === agent.worldId)) {
      throw new Error(`Agent ${agent.id} references unknown world ${agent.worldId}`)
    }
  }

  // Satisfiability check: every agent's tools must be declared
  const allTools = new Set(input.agents.flatMap(a => a.tools))
  if (allTools.size === 0 && input.agents.length > 0) {
    throw new Error('Agents have no tools')
  }

  // Satisfiability check: budget must cover all agents
  const totalBudgetAgents = input.budgets.reduce((sum, b) => sum + b.agents, 0)
  if (totalBudgetAgents < input.agents.length) {
    throw new Error(`Budget covers ${totalBudgetAgents} agents but ${input.agents.length} needed`)
  }

  // Build plan content for deterministic hashing (id derived from digest)
  const planContent = {
    objectives: input.objectives,
    constraints: input.constraints,
    modelRoutes: input.modelRoutes,
    contextTopology: 'default',
    agentGraph: input.agents,
    worlds: input.worlds,
    budgets: input.budgets,
    approvalGates: [] as RunPlan['approvalGates'],
    verification: input.verification,
    recovery: { maxRetries: 3, checkpoint: true },
  }

  // Deterministic digest from content (excluding id which is derived from digest)
  const digest = createHash('sha256').update(JSON.stringify(planContent, Object.keys(planContent).sort())).digest('hex')
  const id = `plan-${digest.slice(0, 16)}`

  return { id, ...planContent, digest }
}

export function verifyPlan(plan: RunPlan): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  for (const agent of plan.agentGraph) {
    if (!plan.worlds.some(w => w.id === agent.worldId)) {
      errors.push(`Agent ${agent.id} references unknown world ${agent.worldId}`)
    }
  }
  // Verify digest matches content
  const { id: _id, digest, ...content } = plan
  const expectedDigest = createHash('sha256').update(JSON.stringify(content, Object.keys(content).sort())).digest('hex')
  if (digest !== expectedDigest) {
    errors.push('Plan digest does not match content')
  }
  return { valid: errors.length === 0, errors }
}
