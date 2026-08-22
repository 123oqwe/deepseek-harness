import { randomUUID } from 'node:crypto'
import type { Run, RunState } from './types.ts'
import { genesisEvent, asRunId } from './events.ts'
import { InMemoryRunStore } from './store.ts'
import type { RunStore } from './store.ts'

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

// Default to in-memory store; production uses JsonlRunStore via setRunStore()
let store: RunStore = new InMemoryRunStore()

export function setRunStore(newStore: RunStore): RunStore {
  const old = store
  store = newStore
  return old
}

export function createRun(principalId: string, tenantId: string): Run {
  const runId = asRunId(randomUUID())
  const now = new Date().toISOString()
  const genesis = genesisEvent(runId)
  const run: Run = {
    id: runId, principalId, tenantId, state: 'pending',
    createdAt: now, updatedAt: now, events: [genesis],
  }
  store.save(run)
  return run
}

export function transition(runId: string, to: RunState): Run {
  const run = store.load(runId)
  if (!run) throw new Error(`Run not found: ${runId}`)
  const allowed = ALLOWED_TRANSITIONS[run.state]
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(run.state, to)
  }
  return store.appendEvent(runId, `run:${to}`, { from: run.state, to })
}

export function getRun(runId: string): Run | undefined {
  return store.load(runId)
}

export function appendEvent(runId: string, type: string, payload: unknown): Run {
  return store.appendEvent(runId, type, payload)
}

export function listRuns(): Run[] {
  return store.list()
}

export function clearRuns(): void {
  store.clear()
}
