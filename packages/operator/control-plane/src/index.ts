import type { ControlPlaneView, ViewType, InterventionRequest, InterventionResult } from './types.ts'
import { randomUUID } from 'node:crypto'

export type { ControlPlaneView, ViewType, InterventionRequest, InterventionResult } from './types.ts'

export class ControlPlaneManager {
  private views = new Map<string, ControlPlaneView[]>()
  private interventions: InterventionResult[] = []
  private runStates = new Map<string, string>()

  setRunState(runId: string, state: string): void {
    this.runStates.set(runId, state)
  }

  getRunState(runId: string): string | undefined {
    return this.runStates.get(runId)
  }

  generateView(runId: string, viewType: ViewType, data: unknown): ControlPlaneView {
    const view: ControlPlaneView = {
      viewType, runId, data, generatedAt: Date.now(),
    }
    const list = this.views.get(runId) ?? []
    list.push(view)
    this.views.set(runId, list)
    return view
  }

  getViews(runId: string): readonly ControlPlaneView[] {
    return this.views.get(runId) ?? []
  }

  requestIntervention(req: Omit<InterventionRequest, 'interventionId' | 'safe'>): InterventionResult {
    const runState = this.runStates.get(req.runId)
    const safe = runState !== undefined && runState !== 'cancelled' && runState !== 'closed'
    const interventionId = `int-${randomUUID().slice(0, 12)}`

    if (!safe) {
      const result: InterventionResult = {
        accepted: false, interventionId,
        reason: `Run is in ${runState ?? 'unknown'} state, intervention not safe`,
      }
      this.interventions.push(result)
      return result
    }

    const result: InterventionResult = {
      accepted: true, interventionId, reason: `Intervention ${req.type} accepted for ${req.runId}`,
    }
    this.interventions.push(result)
    return result
  }

  getInterventions(): readonly InterventionResult[] {
    return this.interventions
  }

  clear(): void {
    this.views.clear()
    this.interventions = []
    this.runStates.clear()
  }
}
