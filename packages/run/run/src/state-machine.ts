import { randomUUID } from 'node:crypto'
import type { Run, RunState } from './types.ts'
import { createEvent, genesisEvent, asRunId } from './events.ts'

const ALLOWED_TRANSITIONS: Record<RunState, RunState[]> = {
  pending: ['running', 'cancelled'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

export class InvalidTransitionError extends Error {
  constructor(from: RunState, to: RunState) {
    super(`Invalid run state transition: ${from} -> ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

const runs = new Map<string, Run>()

export function createRun(principalId: string, tenantId: string): Run {
  const runId = asRunId(randomUUID())
  const now = new Date().toISOString()
  const genesis = genesisEvent(runId)
  const run: Run = {
    id: runId, principalId, tenantId, state: 'pending',
    createdAt: now, updatedAt: now, events: [genesis],
  }
  runs.set(String(runId), run)
  return run
}

export function transition(runId: string, to: RunState): Run {
  const run = runs.get(runId)
  if (!run) throw new Error(`Run not found: ${runId}`)
  const allowed = ALLOWED_TRANSITIONS[run.state]
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(run.state, to)
  }
  const lastEvent = run.events[run.events.length - 1]
  if (!lastEvent) throw new Error('Run has no genesis event')
  const event = createEvent(run.id, run.events.length, `run:${to}`, { from: run.state, to }, lastEvent.hash)
  const updated: Run = {
    ...run, state: to, updatedAt: event.timestamp, events: [...run.events, event],
  }
  runs.set(runId, updated)
  return updated
}

export function getRun(runId: string): Run | undefined {
  return runs.get(runId)
}

export function appendEvent(runId: string, type: string, payload: unknown): Run {
  const run = runs.get(runId)
  if (!run) throw new Error(`Run not found: ${runId}`)
  const lastEvent = run.events[run.events.length - 1]
  if (!lastEvent) throw new Error('Run has no genesis event')
  const event = createEvent(run.id, run.events.length, type, payload, lastEvent.hash)
  const updated: Run = { ...run, updatedAt: event.timestamp, events: [...run.events, event] }
  runs.set(runId, updated)
  return updated
}

export function clearRuns(): void {
  runs.clear()
}
