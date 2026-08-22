import { randomUUID } from 'node:crypto'
import type { EmergencyStopOrder, HumanInteractionRequest } from './types.ts'

export type { EmergencyAction, EmergencyStopOrder, HumanInteractionRequest } from './types.ts'

const stopOrders: EmergencyStopOrder[] = []
let globalStop = false

export function issueEmergencyStop(action: EmergencyAction, reason: string, issuedBy: string, runId?: string): EmergencyStopOrder {
  const order: EmergencyStopOrder = {
    id: randomUUID(),
    action,
    runId,
    reason,
    issuedBy,
    issuedAt: new Date().toISOString(),
    persistent: true,
  }
  stopOrders.push(order)
  if (action === 'pause-new-actions' || action === 'kill-execution-world') {
    globalStop = true
  }
  return order
}

export function isGloballyStopped(): boolean {
  return globalStop
}

export function resume(): void {
  globalStop = false
}

export function getStopOrders(): EmergencyStopOrder[] {
  return [...stopOrders]
}

export function clearStopOrders(): void {
  stopOrders.length = 0
  globalStop = false
}

const interactions: HumanInteractionRequest[] = []

export function createInteraction(runId: string, type: HumanInteractionRequest['type'], prompt: string, options?: string[]): HumanInteractionRequest {
  const req: HumanInteractionRequest = {
    id: randomUUID(),
    runId,
    type,
    prompt,
    options,
    timeout: 30000,
  }
  interactions.push(req)
  return req
}

export function getInteractions(runId: string): HumanInteractionRequest[] {
  return interactions.filter(i => i.runId === runId)
}

export function clearInteractions(): void {
  interactions.length = 0
}
