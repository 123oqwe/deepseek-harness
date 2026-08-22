import type { QuorumSpec, ApprovalVote, QuorumState, QuorumResult } from './types.ts'

export type { QuorumSpec, ApprovalVote, QuorumState, QuorumResult } from './types.ts'

export class ApprovalQuorum {
  private readonly states = new Map<string, QuorumState>()

  initiate(requestId: string, spec: QuorumSpec, initiator: string): QuorumState {
    const state: QuorumState = { spec, votes: [], status: 'pending', initiator }
    this.states.set(requestId, state)
    return state
  }

  submitVote(requestId: string, vote: ApprovalVote): QuorumState {
    const state = this.states.get(requestId)
    if (!state) throw new Error(`Unknown request ${requestId}`)
    if (state.status !== 'pending') throw new Error(`Request is ${state.status}`)

    // Initiator cannot approve (separation of duties)
    if (vote.approver === state.initiator) {
      throw new Error('Initiator cannot approve their own request')
    }

    // Check role is required
    if (!state.spec.requiredRoles.includes(vote.role)) {
      throw new Error(`Role ${vote.role} is not in required roles`)
    }

    // Check if already voted (before mutual exclusion, so duplicate is caught first)
    if (state.votes.some(v => v.approver === vote.approver)) {
      throw new Error('Approver has already voted')
    }

    // Check mutual exclusion: same person cannot hold multiple excluded roles
    for (const group of state.spec.mutualExclusion) {
      if (group.includes(vote.role)) {
        const hasConflict = state.votes.some(v => group.includes(v.role) && v.approver === vote.approver)
        if (hasConflict) {
          throw new Error('Mutual exclusion violation: approver already holds a role in this exclusion group')
        }
      }
    }

    // Check ordered approval: role index must match vote count
    if (state.spec.ordered) {
      const expectedRole = state.spec.requiredRoles[state.votes.length]
      if (vote.role !== expectedRole) {
        throw new Error(`Ordered approval violated: expected ${expectedRole ?? 'end'}, got ${vote.role}`)
      }
    }

    // Check action manifest digest consistency
    for (const v of state.votes) {
      if (v.actionManifestDigest !== vote.actionManifestDigest) {
        throw new Error('Action manifest digest mismatch')
      }
    }

    const newVotes = [...state.votes, vote]
    let status: QuorumResult = 'pending'

    // Any deny means denied
    if (vote.decision === 'deny') {
      status = 'denied'
    } else {
      // Check if quorum satisfied
      const approvals = newVotes.filter(v => v.decision === 'approve')
      const uniqueApprovers = new Set(approvals.map(v => v.approver))
      const uniqueRoles = new Set(approvals.map(v => v.role))

      if (uniqueApprovers.size >= state.spec.minApprovals &&
          state.spec.requiredRoles.every(r => uniqueRoles.has(r))) {
        status = 'satisfied'
      }
    }

    const newState: QuorumState = { ...state, votes: newVotes, status }
    this.states.set(requestId, newState)
    return newState
  }

  checkExpiry(requestId: string, now: number): QuorumState {
    const state = this.states.get(requestId)
    if (!state) throw new Error(`Unknown request ${requestId}`)
    if (state.status === 'pending' && now > state.spec.timeoutMs) {
      const newState: QuorumState = { ...state, status: 'expired' }
      this.states.set(requestId, newState)
      return newState
    }
    return state
  }

  getState(requestId: string): QuorumState | undefined {
    return this.states.get(requestId)
  }
}
