import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { issueEmergencyStop, isGloballyStopped, resume, getStopOrders, clearStopOrders, createInteraction, getInteractions, clearInteractions } from '../src/index.ts'

describe('P2-12 Emergency Stop and Human Interaction Channel', () => {
  beforeEach(() => { clearStopOrders(); clearInteractions() })
  afterEach(() => { clearStopOrders(); clearInteractions() })

  it('issues emergency stop for pause-new-actions', () => {
    issueEmergencyStop('pause-new-actions', 'security incident', 'admin')
    expect(isGloballyStopped()).toBe(true)
  })

  it('issues emergency stop for kill-execution-world', () => {
    issueEmergencyStop('kill-execution-world', 'hostile plugin detected', 'kernel')
    expect(isGloballyStopped()).toBe(true)
  })

  it('cancel-run does not set global stop', () => {
    issueEmergencyStop('cancel-run', 'user requested', 'user', 'run-1')
    expect(isGloballyStopped()).toBe(false)
  })

  it('resume clears global stop', () => {
    issueEmergencyStop('pause-new-actions', 'test', 'admin')
    expect(isGloballyStopped()).toBe(true)
    resume()
    expect(isGloballyStopped()).toBe(false)
  })

  it('stop orders are persistent', () => {
    issueEmergencyStop('cancel-run', 'test', 'admin', 'run-1')
    const orders = getStopOrders()
    expect(orders).toHaveLength(1)
    expect(orders[0]!.persistent).toBe(true)
  })

  it('creates human interaction request', () => {
    const req = createInteraction('run-1', 'question', 'Which file to edit?')
    expect(req.id).toBeTruthy()
    expect(req.type).toBe('question')
    expect(getInteractions('run-1')).toHaveLength(1)
  })

  it('creates interaction with options', () => {
    createInteraction('run-1', 'choice', 'Pick one', ['A', 'B', 'C'])
    const interactions = getInteractions('run-1')
    expect(interactions[0]!.options).toEqual(['A', 'B', 'C'])
  })
})
