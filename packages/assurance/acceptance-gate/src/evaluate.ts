import type { GateInput, GateDecision, RunState } from './types.ts'

const TRANSITIONS: Record<RunState, RunState[]> = {
  running: ['completed', 'verifying'],
  completed: ['verifying'],
  verifying: ['accepted', 'rejected', 'needs-human', 'compensating'],
  accepted: [],
  rejected: ['compensating', 'needs-human'],
  'needs-human': ['verifying'],
  compensating: ['verifying', 'rejected'],
}

export function canTransition(from: RunState, to: RunState): boolean {
  // eslint-disable-next-line no-unnecessary-condition
  // eslint-disable-next-line no-unnecessary-condition
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function evaluateGate(input: GateInput, currentState: RunState): GateDecision {
  if (currentState === 'running') {
    return { newState: 'completed', accepted: false, reason: 'Execution still running' }
  }
  if (currentState === 'completed') {
    return { newState: 'verifying', accepted: false, reason: 'Execution completed, entering verification' }
  }
  if (currentState !== 'verifying') {
    return { newState: currentState, accepted: false, reason: `Cannot evaluate gate from ${currentState}` }
  }

  for (const check of input.requiredChecks) {
    if (!check.required) continue
    const result = input.verificationResults.find(r => r.checkId === check.checkId)
    if (!result) {
      return { newState: 'rejected', accepted: false, reason: `Missing required check: ${check.checkId}` }
    }
    if (result.status !== 'pass') {
      return { newState: 'rejected', accepted: false, reason: `Required check failed: ${check.checkId}` }
    }
  }

  const conflictedClaims = input.claimGraphStatuses.filter(c => c.status === 'conflicted')
  if (conflictedClaims.length > 0) {
    return { newState: 'needs-human', accepted: false, reason: `Conflicted claims: ${conflictedClaims.map(c => c.claimId).join(', ')}` }
  }

  for (const approval of input.requiredApprovals) {
    if (!approval.approved) {
      return { newState: 'needs-human', accepted: false, reason: `Pending approval: ${approval.approvalId}` }
    }
  }

  return { newState: 'accepted', accepted: true, reason: 'All required checks passed, claims verified, approvals granted' }
}
