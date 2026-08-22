import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Run, RunEvent, RunState } from './types.ts'
import { createEvent } from './events.ts'

export interface RunStore {
  save(run: Run): void
  load(runId: string): Run | undefined
  list(): Run[]
  appendEvent(runId: string, type: string, payload: unknown): Run
  clear(): void
}

/** In-memory store (for tests only; not production durability). */
export class InMemoryRunStore implements RunStore {
  private runs = new Map<string, Run>()

  save(run: Run): void { this.runs.set(String(run.id), run) }
  load(runId: string): Run | undefined { return this.runs.get(runId) }
  list(): Run[] { return Array.from(this.runs.values()) }
  clear(): void { this.runs.clear() }

  appendEvent(runId: string, type: string, payload: unknown): Run {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    const lastEvent = run.events[run.events.length - 1]
    if (!lastEvent) throw new Error('Run has no genesis event')
    const event = createEvent(run.id, run.events.length, type, payload, lastEvent.hash)
    const newState = type.startsWith('run:') ? type.replace('run:', '') as RunState : run.state
    const updated: Run = { ...run, state: newState, updatedAt: event.timestamp, events: [...run.events, event] }
    this.runs.set(runId, updated)
    return updated
  }
}

/** JSONL-based durable store (append-only event ledger per run). */
export class JsonlRunStore implements RunStore {
  private runs = new Map<string, Run>()
  private readonly dataDir: string

  constructor(dataDir: string) {
    this.dataDir = dataDir
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    this.replay()
  }

  private ledgerPath(runId: string): string {
    const safe = runId.replace(/[^a-zA-Z0-9-]/g, '_')
    return join(this.dataDir, `${safe}.jsonl`)
  }

  /** Replay all event logs from disk to rebuild in-memory state. */
  private replay(): void {
    if (!existsSync(this.dataDir)) return
    for (const file of readdirSync(this.dataDir)) {
      if (!file.endsWith('.jsonl')) continue
      const content = readFileSync(join(this.dataDir, file), 'utf8')
      const events: RunEvent[] = []
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          events.push(JSON.parse(line) as RunEvent)
        } catch { /* skip corrupt lines */ }
      }
      if (events.length === 0) continue
      const genesis = events[0]
      if (!genesis) continue
      const runId = genesis.runId
      let run: Run = {
        id: runId,
        principalId: (genesis.payload as { runId?: string }).runId ?? 'unknown',
        tenantId: 'default',
        state: 'pending',
        createdAt: genesis.timestamp,
        updatedAt: genesis.timestamp,
        events: [genesis],
      }
      for (let i = 1; i < events.length; i++) {
        const evt = events[i]
        if (!evt) continue
        if (evt.type.startsWith('run:')) {
          const newState = evt.type.replace('run:', '') as RunState
          run = { ...run, state: newState, updatedAt: evt.timestamp, events: [...run.events, evt] }
        } else {
          run = { ...run, updatedAt: evt.timestamp, events: [...run.events, evt] }
        }
      }
      this.runs.set(String(runId), run)
    }
  }

  save(run: Run): void {
    this.runs.set(String(run.id), run)
    const path = this.ledgerPath(String(run.id))
    const lines = run.events.map(e => JSON.stringify(e)).join('\n') + '\n'
    writeFileSync(path, lines)
  }

  load(runId: string): Run | undefined { return this.runs.get(runId) }
  list(): Run[] { return Array.from(this.runs.values()) }
  clear(): void {
    this.runs.clear()
    if (existsSync(this.dataDir)) {
      rmSync(this.dataDir, { recursive: true, force: true })
      mkdirSync(this.dataDir, { recursive: true })
    }
  }

  appendEvent(runId: string, type: string, payload: unknown): Run {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    const lastEvent = run.events[run.events.length - 1]
    if (!lastEvent) throw new Error('Run has no genesis event')
    const event = createEvent(run.id, run.events.length, type, payload, lastEvent.hash)
    const path = this.ledgerPath(runId)
    appendFileSync(path, JSON.stringify(event) + '\n')
    const newState = type.startsWith('run:') ? type.replace('run:', '') as RunState : run.state
    const updated: Run = { ...run, state: newState, updatedAt: event.timestamp, events: [...run.events, event] }
    this.runs.set(runId, updated)
    return updated
  }
}
