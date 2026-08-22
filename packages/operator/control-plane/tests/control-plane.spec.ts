import { describe, it, expect, beforeEach } from 'vitest'
import { ControlPlaneManager } from '../src/index.ts'

describe('P8-08 Operator Control Plane', () => {
  let cp: ControlPlaneManager

  beforeEach(() => { cp = new ControlPlaneManager() })

  it('generates run-graph view', () => {
    cp.setRunState('r1', 'running')
    const view = cp.generateView('r1', 'run-graph', { nodes: 3 })
    expect(view.viewType).toBe('run-graph')
    expect(view.runId).toBe('r1')
  })

  it('retrieves all views for a run', () => {
    cp.setRunState('r1', 'running')
    cp.generateView('r1', 'run-graph', {})
    cp.generateView('r1', 'budget', {})
    expect(cp.getViews('r1')).toHaveLength(2)
  })

  it('allows safe intervention on running run', () => {
    cp.setRunState('r1', 'running')
    const result = cp.requestIntervention({ runId: 'r1', type: 'pause', reason: 'test' })
    expect(result.accepted).toBe(true)
  })

  it('rejects intervention on cancelled run', () => {
    cp.setRunState('r1', 'cancelled')
    const result = cp.requestIntervention({ runId: 'r1', type: 'pause', reason: 'test' })
    expect(result.accepted).toBe(false)
  })

  it('rejects intervention on closed run', () => {
    cp.setRunState('r1', 'closed')
    const result = cp.requestIntervention({ runId: 'r1', type: 'resume', reason: 'test' })
    expect(result.accepted).toBe(false)
  })

  it('tracks intervention history', () => {
    cp.setRunState('r1', 'running')
    cp.requestIntervention({ runId: 'r1', type: 'pause', reason: 'test1' })
    cp.requestIntervention({ runId: 'r1', type: 'steer', reason: 'test2' })
    expect(cp.getInterventions()).toHaveLength(2)
  })

  it('generates all view types', () => {
    cp.setRunState('r1', 'running')
    const types = ['run-graph', 'agent-list', 'workflow-phases', 'budget', 'action-trace', 'policy-decisions', 'approvals', 'evidence', 'repair', 'world-state'] as const
    for (const t of types) cp.generateView('r1', t, {})
    expect(cp.getViews('r1')).toHaveLength(10)
  })

  it('approve intervention type is supported', () => {
    cp.setRunState('r1', 'verifying')
    const result = cp.requestIntervention({ runId: 'r1', type: 'approve', reason: 'user approved' })
    expect(result.accepted).toBe(true)
  })
})
