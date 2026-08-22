import { describe, it, expect, beforeEach } from 'vitest'
import { TriggerService } from '../src/index.ts'

describe('P4-14 Trigger Service & Durable Schedule', () => {
  let svc: TriggerService

  beforeEach(() => { svc = new TriggerService() })

  it('schedules a trigger', () => {
    const t = svc.schedule('schedule', 'r1', Date.now() + 1000)
    expect(t.triggerType).toBe('schedule')
    expect(t.catchUpPolicy).toBe('fire-once')
  })

  it('fires due triggers', () => {
    svc.schedule('schedule', 'r1', Date.now() - 1000)
    const fired = svc.fireDue(Date.now())
    expect(fired).toHaveLength(1)
    expect(fired[0]?.firedAt).toBeDefined()
  })

  it('does not fire future triggers', () => {
    svc.schedule('schedule', 'r1', Date.now() + 10000)
    const fired = svc.fireDue(Date.now())
    expect(fired).toHaveLength(0)
  })

  it('prevents duplicate firing with fire-once', () => {
    const time = Date.now() - 1000
    svc.schedule('schedule', 'r1', time, 'UTC', 'fire-once')
    svc.fireDue(Date.now())
    const fired2 = svc.fireDue(Date.now())
    expect(fired2).toHaveLength(0)
  })

  it('DST adjustment', () => {
    const t = svc.schedule('schedule', 'r1', 1000000, 'America/New_York')
    const result = svc.handleDST(t, -5)
    expect(result.adjusted).toBe(true)
    expect(result.newTime).toBe(1000000 - 5 * 3600 * 1000)
  })

  it('get triggers for run', () => {
    svc.schedule('goal', 'r1', Date.now())
    svc.schedule('schedule', 'r2', Date.now())
    expect(svc.getTriggers('r1')).toHaveLength(1)
  })

  it('isDuplicate checks fired history', () => {
    const t = svc.schedule('schedule', 'r1', Date.now() - 1000)
    svc.fireDue(Date.now())
    expect(svc.isDuplicate(t.triggerId)).toBe(true)
  })
})
