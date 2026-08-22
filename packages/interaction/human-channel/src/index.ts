import type { ServerRequest, ServerResponse, RequestStatus } from './types.ts'

export type { ServerRequest, ServerResponse, ServerRequestType, RequestStatus } from './types.ts'

export class HumanInteractionChannel {
  private requests = new Map<string, { request: ServerRequest; responses: ServerResponse[]; status: RequestStatus }>()

  sendRequest(request: ServerRequest): { sent: boolean; reason: string } {
    if (this.requests.has(request.id)) {
      return { sent: false, reason: 'Request already exists' }
    }
    this.requests.set(request.id, { request, responses: [], status: 'pending' })
    return { sent: true, reason: 'sent' }
  }

  submitResponse(response: ServerResponse): { accepted: boolean; reason: string; status: RequestStatus } {
    const entry = this.requests.get(response.requestId)
    if (!entry) return { accepted: false, reason: 'Unknown request', status: 'pending' }
    if (entry.status !== 'pending') {
      return { accepted: false, reason: `Request is ${entry.status}`, status: entry.status }
    }
    if (Date.now() > entry.request.deadline) {
      entry.status = 'expired'
      return { accepted: false, reason: 'Request expired', status: 'expired' }
    }
    // Check role requirement
    if (entry.request.requiredRoles && !entry.request.requiredRoles.includes(response.role)) {
      return { accepted: false, reason: 'Role not authorized', status: 'pending' }
    }
    entry.responses.push(response)
    // Check if quorum satisfied
    if (entry.request.minApprovals) {
      const approvals = entry.responses.filter(r => r.decision === 'approve')
      if (approvals.length >= entry.request.minApprovals) {
        entry.status = 'answered'
      }
    } else {
      // Single response suffices
      entry.status = 'answered'
    }
    return { accepted: true, reason: 'response recorded', status: entry.status }
  }

  getRequest(id: string): { request: ServerRequest; responses: readonly ServerResponse[]; status: RequestStatus } | undefined {
    const entry = this.requests.get(id)
    if (!entry) return undefined
    return { request: entry.request, responses: entry.responses, status: entry.status }
  }

  cancelRequest(id: string): { cancelled: boolean; reason: string } {
    const entry = this.requests.get(id)
    if (!entry) return { cancelled: false, reason: 'not found' }
    if (entry.status === 'answered') return { cancelled: false, reason: 'already answered' }
    entry.status = 'cancelled'
    return { cancelled: true, reason: 'cancelled' }
  }

  getPendingRequests(): readonly ServerRequest[] {
    return Array.from(this.requests.values())
      .filter(e => e.status === 'pending')
      .map(e => e.request)
  }
}
