import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRun, transition, getRun, appendEvent, clearRuns, InvalidTransitionError } from '../src/index.ts'

describe('P4-01 Run Service State Machine', () => {
  beforeEach(() => clearRuns())
  afterEach(() => clearRuns())

  it('creates a run in pending state', () => {
    const run = createRun('user-1', 'tenant-a')
    expect(run.state).toBe('pending')
    expect(run.events.length).toBe(1)
    expect(run.events[0]!.type).toBe('run:created')
  })

  it('transitions pending -> running -> completed', () => {
    const run = createRun('user-1', 'tenant-a')
    const running = transition(String(run.id), 'running')
    expect(running.state).toBe('running')
    const completed = transition(String(run.id), 'completed')
    expect(completed.state).toBe('completed')
  })

  it('rejects invalid transition', () => {
    const run = createRun('user-1', 'tenant-a')
    expect(() => transition(String(run.id), 'completed')).toThrow(InvalidTransitionError)
  })

  it('rejects transition from terminal state', () => {
    const run = createRun('user-1', 'tenant-a')
    transition(String(run.id), 'running')
    transition(String(run.id), 'completed')
    expect(() => transition(String(run.id), 'running')).toThrow(InvalidTransitionError)
  })

  it('appends events to event log', () => {
    const run = createRun('user-1', 'tenant-a')
    transition(String(run.id), 'running')
    const updated = appendEvent(String(run.id), 'tool:called', { tool: 'fs:read' })
    expect(updated.events.length).toBe(3)
    expect(updated.events[2]!.type).toBe('tool:called')
  })

  it('event log is tamper-evident', () => {
    const run = createRun('user-1', 'tenant-a')
    transition(String(run.id), 'running')
    const updated = appendEvent(String(run.id), 'test', { data: 'test' })
    const lastEvent = updated.events[updated.events.length - 1]!
    const prevEvent = updated.events[updated.events.length - 2]!
    expect(lastEvent.prevHash).toBe(prevEvent.hash)
    expect(lastEvent.hash).not.toBe(lastEvent.prevHash)
  })

  it('paused -> running -> cancelled', () => {
    const run = createRun('user-1', 'tenant-a')
    transition(String(run.id), 'running')
    transition(String(run.id), 'paused')
    transition(String(run.id), 'running')
    transition(String(run.id), 'cancelled')
    const final = getRun(String(run.id))
    expect(final!.state).toBe('cancelled')
  })
})
