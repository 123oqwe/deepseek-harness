import { createHash } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RunEvent, RunId } from './types.ts'

const GENESIS = createHash('sha256').update('').digest('hex')

function asRunId(s: string): Branded<'RunId'> {
  return s as Branded<'RunId'>
}

export function createEvent(runId: RunId, seq: number, type: string, payload: unknown, prevHash: string): RunEvent {
  const canonical = JSON.stringify(payload)
  const hash = createHash('sha256').update(`${seq}:${runId}:${type}:${canonical}:${prevHash}`).digest('hex')
  return { seq, runId, type, timestamp: new Date().toISOString(), payload, prevHash, hash }
}

export function genesisEvent(runId: RunId): RunEvent {
  return createEvent(runId, 0, 'run:created', { runId: String(runId) }, GENESIS)
}

export { asRunId, GENESIS }
