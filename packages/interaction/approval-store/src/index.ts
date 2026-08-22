import { randomUUID } from 'node:crypto'
import type { ApprovalRecord, ApprovalState } from './types.ts'

export type { ApprovalState, ApprovalRecord } from './types.ts'

const store = new Map<string, ApprovalRecord>()
const waitingRuns = new Set<string>()

export function request(runId: string, requestDigest: string, policyVersion: string, actor: string, deadlineMs: number = 86400000): ApprovalRecord {
  const record: ApprovalRecord = {
    id: randomUUID(),
    runId,
    state: 'requested',
    requestDigest,
    policyVersion,
    actor,
    deadline: new Date(Date.now() + deadlineMs).toISOString(),
    createdAt: new Date().toISOString(),
  }
  store.set(record.id, record)
  waitingRuns.add(runId)
  return record
}

export function approve(id: string, decidedBy: string): ApprovalRecord {
  const record = store.get(id)
  if (!record) throw new Error(`Approval not found: ${id}`)
  if (record.state !== 'requested') throw new Error(`Approval ${id} is ${record.state}`)
  if (new Date(record.deadline) < new Date()) {
    const expired: ApprovalRecord = { ...record, state: 'expired' }
    store.set(id, expired)
    throw new Error(`Approval ${id} has expired`)
  }
  const approved: ApprovalRecord = { ...record, state: 'approved', decidedAt: new Date().toISOString(), decidedBy }
  store.set(id, approved)
  waitingRuns.delete(record.runId)
  return approved
}

export function deny(id: string, decidedBy: string, reason: string): ApprovalRecord {
  const record = store.get(id)
  if (!record) throw new Error(`Approval not found: ${id}`)
  if (record.state !== 'requested') throw new Error(`Approval ${id} is ${record.state}`)
  const denied: ApprovalRecord = { ...record, state: 'denied', decidedAt: new Date().toISOString(), decidedBy, rejectionReason: reason }
  store.set(id, denied)
  waitingRuns.delete(record.runId)
  return denied
}

export function consume(id: string): ApprovalRecord {
  const record = store.get(id)
  if (!record) throw new Error(`Approval not found: ${id}`)
  if (record.state !== 'approved') throw new Error(`Cannot consume: approval is ${record.state}`)
  const consumed: ApprovalRecord = { ...record, state: 'consumed', consumedAt: new Date().toISOString() }
  store.set(id, consumed)
  return consumed
}

export function revoke(id: string): ApprovalRecord {
  const record = store.get(id)
  if (!record) throw new Error(`Approval not found: ${id}`)
  const revoked: ApprovalRecord = { ...record, state: 'revoked' }
  store.set(id, revoked)
  return revoked
}

export function get(id: string): ApprovalRecord | undefined { return store.get(id) }
export function getByRun(runId: string): ApprovalRecord[] { return Array.from(store.values()).filter(r => r.runId === runId) }
export function isWaiting(runId: string): boolean { return waitingRuns.has(runId) }
export function getPending(): ApprovalRecord[] { return Array.from(store.values()).filter(r => r.state === 'requested') }
export function clearStore(): void { store.clear(); waitingRuns.clear() }
