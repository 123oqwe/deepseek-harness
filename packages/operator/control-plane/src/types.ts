export type ViewType = 'run-graph' | 'agent-list' | 'workflow-phases' | 'budget' | 'action-trace' | 'policy-decisions' | 'approvals' | 'evidence' | 'repair' | 'world-state'

export interface ControlPlaneView {
  readonly viewType: ViewType
  readonly runId: string
  readonly data: unknown
  readonly generatedAt: number
}

export interface InterventionRequest {
  readonly interventionId: string
  readonly runId: string
  readonly type: 'pause' | 'resume' | 'cancel' | 'approve' | 'steer'
  readonly reason: string
  readonly safe: boolean
}

export interface InterventionResult {
  readonly accepted: boolean
  readonly interventionId: string
  readonly reason: string
}
