import { randomUUID } from 'node:crypto'

export type ControlMessageType = 'continue' | 'steer' | 'inject' | 'cancel' | 'human-answer'

export interface ControlMessage {
  readonly id: string
  readonly type: ControlMessageType
  readonly runId: string
  readonly epoch: number
  readonly payload: unknown
  readonly timestamp: string
  readonly idempotencyKey: string
}

const PRIORITY: Record<ControlMessageType, number> = {
  cancel: 100,
  'human-answer': 80,
  steer: 60,
  inject: 40,
  continue: 20,
}

const messages: ControlMessage[] = []
const cancelledRuns = new Set<string>()
const usedIdempotencyKeys = new Set<string>()

export function sendControl(type: ControlMessageType, runId: string, epoch: number, payload: unknown = {}): ControlMessage {
  const key = `${runId}:${type}:${epoch}`
  if (usedIdempotencyKeys.has(key)) {
    return messages.find(m => m.idempotencyKey === key)!
  }
  usedIdempotencyKeys.add(key)

  const msg: ControlMessage = {
    id: randomUUID(),
    type,
    runId,
    epoch,
    payload,
    timestamp: new Date().toISOString(),
    idempotencyKey: key,
  }
  messages.push(msg)

  if (type === 'cancel') {
    cancelledRuns.add(runId)
  }

  return msg
}

export function getMessages(runId: string): ControlMessage[] {
  return messages.filter(m => m.runId === runId).sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type])
}

export function isCancelled(runId: string): boolean {
  return cancelledRuns.has(runId)
}

export function canDeliver(msg: ControlMessage, runId: string): boolean {
  // After cancellation, only human-answer can be delivered
  if (isCancelled(runId) && msg.type !== 'human-answer') {
    return false
  }
  return true
}

export function getConvergenceStatus(runId: string): { converged: boolean; pendingActions: string[] } {
  const pending: string[] = []
  const runMessages = messages.filter(m => m.runId === runId)

  if (isCancelled(runId)) {
    // Check if all actions have stopped
    const hasCancel = runMessages.some(m => m.type === 'cancel')
    if (hasCancel) {
      return { converged: true, pendingActions: [] }
    }
    pending.push('waiting for cancellation confirmation')
  }

  return { converged: pending.length === 0, pendingActions: pending }
}

export function clearMessages(): void {
  messages.length = 0
  cancelledRuns.clear()
  usedIdempotencyKeys.clear()
}
