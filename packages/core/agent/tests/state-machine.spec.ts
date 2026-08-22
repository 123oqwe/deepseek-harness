import { describe, it, expect } from 'vitest'
import { canTransition, assertTransition, createTransition, isTerminal, isActive, isWaiting, InvalidAgentTransitionError } from '../src/state-machine.ts'

describe('P4-05 Agent Lifecycle State Machine', () => {
  it('allows queued -> starting', () => {
    expect(canTransition('queued', 'starting')).toBe(true)
  })

  it('allows running -> waiting_tool', () => {
    expect(canTransition('running', 'waiting_tool')).toBe(true)
  })

  it('allows running -> completed', () => {
    expect(canTransition('running', 'completed')).toBe(true)
  })

  it('rejects completed -> running', () => {
    expect(canTransition('completed', 'running')).toBe(false)
  })

  it('rejects failed -> running', () => {
    expect(canTransition('failed', 'running')).toBe(false)
  })

  it('allows orphaned -> starting (recovery)', () => {
    expect(canTransition('orphaned', 'starting')).toBe(true)
  })

  it('assertTransition throws on invalid', () => {
    expect(() =>{  assertTransition('completed', 'running') }).toThrow(InvalidAgentTransitionError)
  })

  it('createTransition creates valid transition', () => {
    const t = createTransition('running', 'waiting_tool', 'tool called', 'run-1', 1)
    expect(t.from).toBe('running')
    expect(t.to).toBe('waiting_tool')
    expect(t.reason).toBe('tool called')
    expect(t.runId).toBe('run-1')
    expect(t.leaseEpoch).toBe(1)
  })

  it('isTerminal identifies completed and failed', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('running')).toBe(false)
  })

  it('isActive excludes terminal and orphaned', () => {
    expect(isActive('running')).toBe(true)
    expect(isActive('orphaned')).toBe(false)
    expect(isActive('completed')).toBe(false)
  })

  it('isWaiting identifies waiting states', () => {
    expect(isWaiting('waiting_tool')).toBe(true)
    expect(isWaiting('waiting_human')).toBe(true)
    expect(isWaiting('running')).toBe(false)
  })

  it('allows paused -> running (resume)', () => {
    expect(canTransition('paused', 'running')).toBe(true)
  })

  it('allows cancelling -> completed or failed', () => {
    expect(canTransition('cancelling', 'completed')).toBe(true)
    expect(canTransition('cancelling', 'failed')).toBe(true)
  })
})
