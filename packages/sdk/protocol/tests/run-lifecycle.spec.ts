import { describe, it, expect, beforeEach } from 'vitest'
import { RunControlManager } from '../../../api/remotes/src/run-control.ts'
import type { CommandRequest } from '../src/commands.ts'
import { validateTransition } from '../src/commands.ts'

function makeCmd(runId: string, command: CommandRequest['command'], revision = 1, commandId?: string): CommandRequest {
  return {
    commandId: commandId ?? `cmd-${command}-${runId}`,
    idempotencyKey: `idem-${commandId ?? command}`,
    runId, command, expectedRevision: revision, reason: 'test',
  }
}

describe('P8-03 Remote Lifecycle Control', () => {
  let mgr: RunControlManager

  beforeEach(() => { mgr = new RunControlManager() })

  it('pauses a running run', () => {
    mgr.createRun('r1')
    const result = mgr.executeCommand(makeCmd('r1', 'pause'))
    expect(result.accepted).toBe(true)
    expect(result.currentState).toBe('paused')
    expect(result.revision).toBe(2)
  })

  it('resumes a paused run', () => {
    mgr.createRun('r1')
    mgr.executeCommand(makeCmd('r1', 'pause'))
    const result = mgr.executeCommand(makeCmd('r1', 'resume', 2))
    expect(result.accepted).toBe(true)
    expect(result.currentState).toBe('running')
  })

  it('cancels a running run', () => {
    mgr.createRun('r1')
    const result = mgr.executeCommand(makeCmd('r1', 'cancel'))
    expect(result.accepted).toBe(true)
    expect(result.currentState).toBe('cancelled')
  })

  it('cancel propagates to children', () => {
    mgr.createRun('r1')
    mgr.createRun('child-1')
    mgr.addChild('r1', 'child-1')
    mgr.executeCommand(makeCmd('r1', 'cancel'))
    expect(mgr.getRun('child-1')?.state).toBe('cancelled')
  })

  it('rejects invalid state transitions', () => {
    mgr.createRun('r1')
    mgr.executeCommand(makeCmd('r1', 'cancel'))
    const result = mgr.executeCommand(makeCmd('r1', 'pause', 2))
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('Invalid transition')
  })

  it('rejects stale revision', () => {
    mgr.createRun('r1')
    mgr.executeCommand(makeCmd('r1', 'pause'))
    const result = mgr.executeCommand(makeCmd('r1', 'cancel', 1))
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('Revision mismatch')
  })

  it('duplicate commandId is idempotent', () => {
    mgr.createRun('r1')
    const cmd = makeCmd('r1', 'pause', 1, 'duplicate-cmd-1')
    const result1 = mgr.executeCommand(cmd)
    const result2 = mgr.executeCommand(cmd)
    expect(result1.accepted).toBe(true)
    expect(result2.accepted).toBe(true)
    expect(result2.revision).toBe(result1.revision)
  })

  it('fork creates new run without inheriting secrets', () => {
    mgr.createRun('r1')
    const forkReq: CommandRequest = {
      ...makeCmd('r1', 'fork'),
      forkOptions: { copyContext: true, copyArtifacts: true, inheritSecrets: false },
    }
    const result = mgr.executeCommand(forkReq)
    expect(result.accepted).toBe(true)
    expect(result.currentState).toBe('running')
    expect(result.reason).toContain('secrets inherited: false')
  })

  it('fork lineage is tracked', () => {
    mgr.createRun('r1')
    mgr.executeCommand({ ...makeCmd('r1', 'fork'), forkOptions: { copyContext: true, copyArtifacts: true, inheritSecrets: false } })
    const history = mgr.getForkHistory()
    expect(history).toHaveLength(1)
    expect(history[0]?.parentId).toBe('r1')
    expect(history[0]?.inheritSecrets).toBe(false)
  })

  it('validateTransition checks rules', () => {
    expect(validateTransition('running', 'pause').valid).toBe(true)
    expect(validateTransition('running', 'resume').valid).toBe(false)
    expect(validateTransition('cancelled', 'pause').valid).toBe(false)
    expect(validateTransition('completed', 'close').valid).toBe(true)
  })
})
