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


// P2-12: Global Emergency Stop and Human Interaction Channel

interface StopOrder {
  readonly id: string
  readonly reason: string
  readonly issuedAt: string
  readonly issuer: string
}

interface Interaction {
  readonly id: string
  readonly type: string
  readonly data: unknown
  readonly createdAt: string
}

const stopOrders: StopOrder[] = []
let globallyStopped = false
const interactions: Interaction[] = []

export function issueEmergencyStop(reason: string, issuer: string = 'system', _scope?: string, _runId?: string): StopOrder {
  const order: StopOrder = {
    id: `stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reason,
    issuedAt: new Date().toISOString(),
    issuer,
  }
  stopOrders.push(order)
  globallyStopped = true
  return order
}

export function isGloballyStopped(): boolean {
  return globallyStopped
}

export function resume(): { resumed: boolean; reason: string } {
  if (!globallyStopped) return { resumed: false, reason: 'not stopped' }
  globallyStopped = false
  return { resumed: true, reason: 'resumed' }
}

export function getStopOrders(): readonly StopOrder[] {
  return stopOrders
}

export function clearStopOrders(): void {
  stopOrders.length = 0
  globallyStopped = false
}

export function createInteraction(type: string, data: unknown): Interaction {
  const interaction: Interaction = {
    id: `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    data,
    createdAt: new Date().toISOString(),
  }
  interactions.push(interaction)
  return interaction
}

export function getInteractions(): readonly Interaction[] {
  return interactions
}

export function clearInteractions(): void {
  interactions.length = 0
}
