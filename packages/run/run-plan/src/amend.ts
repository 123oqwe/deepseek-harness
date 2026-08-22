import type { RunPlan } from './types.ts'
import { freezePlan, type FrozenPlan } from './freeze.ts'

export type AmendmentType = 'add-agent' | 'remove-agent' | 'expand-budget' | 'shrink-budget' | 'add-world' | 'change-approval' | 'change-recovery'

export interface PlanAmendment {
  readonly type: AmendmentType
  readonly description: string
  readonly changes: Record<string, unknown>
  readonly requestedBy: string
  readonly requiresApproval: boolean
  readonly approved?: boolean
}

export interface AmendmentResult {
  readonly newRevision: number
  readonly frozenPlan: FrozenPlan
  readonly oldRevision: number
  readonly amendment: PlanAmendment
  readonly status: 'applied' | 'rejected' | 'pending-approval'
  readonly reason: string
}

interface RevisionEntry {
  revision: number
  frozen: FrozenPlan
  amendment?: PlanAmendment
}

export class AmendmentProtocol {
  private revisions: RevisionEntry[] = []
  private currentRevision = 0

  constructor(initialFrozen: FrozenPlan) {
    this.revisions.push({ revision: 0, frozen: initialFrozen })
  }

  proposeAmendment(amendment: PlanAmendment): AmendmentResult {
    const current = this.revisions[this.currentRevision]
    if (!current) {
      return { newRevision: 0, frozenPlan: this.revisions[0]?.frozen ?? initialFrozenEmpty(), oldRevision: 0, amendment, status: 'rejected', reason: 'No current revision' }
    }

    if (amendment.type === 'expand-budget' && !amendment.approved) {
      return {
        newRevision: this.currentRevision,
        frozenPlan: current.frozen,
        oldRevision: this.currentRevision,
        amendment,
        status: 'pending-approval',
        reason: 'Budget expansion requires approval',
      }
    }

    if (amendment.type === 'change-approval' && !amendment.approved) {
      return {
        newRevision: this.currentRevision,
        frozenPlan: current.frozen,
        oldRevision: this.currentRevision,
        amendment,
        status: 'pending-approval',
        reason: 'Approval mode change requires approval',
      }
    }

    const newPlan = this.applyAmendment(current.frozen.plan, amendment)
    const newFrozen = freezePlan(newPlan, amendment.requestedBy)
    this.currentRevision++
    this.revisions.push({ revision: this.currentRevision, frozen: newFrozen, amendment })

    return {
      newRevision: this.currentRevision,
      frozenPlan: newFrozen,
      oldRevision: this.currentRevision - 1,
      amendment,
      status: 'applied',
      reason: 'Amendment applied successfully',
    }
  }

  private applyAmendment(plan: RunPlan, amendment: PlanAmendment): RunPlan {
    switch (amendment.type) {
      case 'add-agent': {
        const agents = [...plan.agentGraph, amendment.changes.agent as RunPlan['agentGraph'][0]]
        return { ...plan, agentGraph: agents }
      }
      case 'remove-agent': {
        const id = amendment.changes.agentId as string
        const agents = plan.agentGraph.filter(a => a.id !== id)
        return { ...plan, agentGraph: agents }
      }
      case 'expand-budget': {
        const budgets = [...plan.budgets, amendment.changes.budget as RunPlan['budgets'][0]]
        return { ...plan, budgets }
      }
      case 'shrink-budget': {
        const idx = amendment.changes.index as number
        const budgets = plan.budgets.filter((_, i) => i !== idx)
        return { ...plan, budgets }
      }
      case 'add-world': {
        const worlds = [...plan.worlds, amendment.changes.world as RunPlan['worlds'][0]]
        return { ...plan, worlds }
      }
      case 'change-approval': {
        return { ...plan, approvalGates: amendment.changes.gates as RunPlan['approvalGates'] }
      }
      case 'change-recovery': {
        return { ...plan, recovery: amendment.changes.recovery as RunPlan['recovery'] }
      }
    }
  }

  getCurrentPlan(): FrozenPlan {
    const current = this.revisions[this.currentRevision]
    if (!current) throw new Error('No current revision')
    return current.frozen
  }

  getRevisionHistory(): readonly RevisionEntry[] {
    return this.revisions
  }

  canSelfEscalate(amendment: PlanAmendment): { allowed: boolean; reason: string } {
    const restricted: AmendmentType[] = ['expand-budget', 'change-approval']
    if (restricted.includes(amendment.type)) {
      return { allowed: false, reason: `Amendment type ${amendment.type} requires external approval` }
    }
    return { allowed: true, reason: 'Self-allowed amendment' }
  }
}

function initialFrozenEmpty(): FrozenPlan {
  return freezePlan({
    id: 'empty',
    objectives: [],
    constraints: [],
    modelRoutes: [],
    contextTopology: 'default',
    agentGraph: [],
    worlds: [],
    budgets: [],
    approvalGates: [],
    verification: { method: '', criteria: [], verifier: '' },
    recovery: { maxRetries: 0, checkpoint: false },
    digest: '',
  }, 'system')
}
