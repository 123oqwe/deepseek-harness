import { describe, it, expect, beforeEach } from 'vitest'
import { TurnCheckpointManager } from '../src/index.ts'

describe('P4-14 Turn Checkpoint & Resume', () => {
  let mgr: TurnCheckpointManager

  beforeEach(() => { mgr = new TurnCheckpointManager() })

  it('creates checkpoint at model_request boundary', () => {
    const cp = mgr.checkpoint('r1', 'model_request', 'hello', 'state-1')
    expect(cp.boundary).toBe('model_request')
    expect(cp.canResume).toBe(true)
  })

  it('gets last checkpoint for run', () => {
    mgr.checkpoint('r1', 'model_request', 'msg', 's1')
    mgr.checkpoint('r1', 'tool_call', 'msg', 's2')
    const last = mgr.getLastCheckpoint('r1')
    expect(last?.boundary).toBe('tool_call')
  })

  it('resume continues when state matches', () => {
    mgr.checkpoint('r1', 'assistant_commit', 'msg', 'state-1')
    const decision = mgr.determineResume('r1', 'state-1')
    expect(decision.action).toBe('continue')
  })

  it('resume replays at tool boundary mismatch', () => {
    mgr.checkpoint('r1', 'tool_call', 'msg', 'state-1')
    const decision = mgr.determineResume('r1', 'state-2')
    expect(decision.action).toBe('replay')
  })

  it('resume reconciles on non-tool mismatch', () => {
    mgr.checkpoint('r1', 'assistant_commit', 'msg', 'state-1')
    const decision = mgr.determineResume('r1', 'state-2')
    expect(decision.action).toBe('reconcile')
  })

  it('resume starts fresh without checkpoint', () => {
    const decision = mgr.determineResume('r1', 'state-1')
    expect(decision.action).toBe('continue')
  })

  it('user message is preserved in checkpoint', () => {
    const cp = mgr.checkpoint('r1', 'model_request', 'important user message', 's1')
    expect(cp.userMessage).toBe('important user message')
  })

  it('lists all checkpoints for a run', () => {
    mgr.checkpoint('r1', 'model_request', 'm1', 's1')
    mgr.checkpoint('r1', 'tool_call', 'm1', 's2')
    mgr.checkpoint('r2', 'model_request', 'm2', 's3')
    expect(mgr.getCheckpoints('r1')).toHaveLength(2)
  })
})
