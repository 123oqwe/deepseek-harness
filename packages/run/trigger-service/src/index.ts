import { randomUUID } from 'node:crypto'

export interface TriggerEvent {
  readonly triggerId: string
  readonly triggerType: 'schedule' | 'goal' | 'external'
  readonly runId: string
  readonly scheduledAt: number
  readonly firedAt?: number | undefined
  readonly catchUpPolicy: 'skip' | 'fire-once' | 'fire-all'
  readonly timezone: string
}

export class TriggerService {
  private triggers: TriggerEvent[] = []
  private firedIds = new Set<string>()

  schedule(triggerType: TriggerEvent['triggerType'], runId: string, scheduledAt: number, timezone = 'UTC', catchUpPolicy: TriggerEvent['catchUpPolicy'] = 'fire-once'): TriggerEvent {
    const trigger: TriggerEvent = {
      triggerId: `trig-${randomUUID().slice(0, 12)}`,
      triggerType, runId, scheduledAt, timezone, catchUpPolicy,
    }
    this.triggers.push(trigger)
    return trigger
  }

  fireDue(now: number): TriggerEvent[] {
    const due = this.triggers.filter(t => !t.firedAt && t.scheduledAt <= now)
    for (const trigger of due) {
      if (this.firedIds.has(trigger.triggerId) && trigger.catchUpPolicy === 'fire-once') continue
      this.firedIds.add(trigger.triggerId)
      const idx = this.triggers.indexOf(trigger)
      this.triggers[idx] = { ...trigger, firedAt: now }
    }
    return due.map(t => this.triggers.find(t2 => t2.triggerId === t.triggerId) ?? t)
  }

  handleDST(trigger: TriggerEvent, offsetHours: number): { adjusted: boolean; newTime: number } {
    const adjustedTime = trigger.scheduledAt + offsetHours * 3600 * 1000
    return { adjusted: offsetHours !== 0, newTime: adjustedTime }
  }

  isDuplicate(triggerId: string): boolean {
    return this.firedIds.has(triggerId)
  }

  getTriggers(runId: string): readonly TriggerEvent[] {
    return this.triggers.filter(t => t.runId === runId)
  }

  clear(): void {
    this.triggers = []
    this.firedIds.clear()
  }
}
