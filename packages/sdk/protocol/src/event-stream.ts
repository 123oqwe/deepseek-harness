export interface StreamEvent {
  readonly eventId: string
  readonly sequence: number
  readonly type: string
  readonly data: unknown
  readonly timestamp: number
}

export interface Cursor {
  readonly lastSequence: number
  readonly sessionId: string
}

export interface AckResult {
  readonly acknowledged: boolean
  readonly newCursor: Cursor
}

export class EventStreamManager {
  private events: StreamEvent[] = []
  private sequenceCounter = 0
  private ackedSequences = new Map<string, number>()
  private subscribers = new Map<string, { cursor: number; buffer: StreamEvent[] }>()
  private maxBufferPerSubscriber = 10000

  publish(type: string, data: unknown, _sessionId: string): StreamEvent {
    const event: StreamEvent = {
      eventId: `evt-${++this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      type, data, timestamp: Date.now(),
    }
    this.events.push(event)
    for (const [, sub] of this.subscribers) {
      if (sub.cursor < event.sequence) {
        sub.buffer.push(event)
        if (sub.buffer.length > this.maxBufferPerSubscriber) {
          sub.buffer.shift()
        }
      }
    }
    return event
  }

  subscribe(sessionId: string, fromSequence = 0): string {
    const subId = `sub-${sessionId}-${Date.now()}`
    const missed = this.events.filter(e => e.sequence > fromSequence)
    this.subscribers.set(subId, { cursor: fromSequence, buffer: [...missed] })
    return subId
  }

  poll(subId: string, maxEvents = 100): StreamEvent[] {
    const sub = this.subscribers.get(subId)
    if (!sub) return []
    const events = sub.buffer.splice(0, maxEvents)
    if (events.length > 0) {
      sub.cursor = events[events.length - 1]?.sequence ?? sub.cursor
    }
    return events
  }

  ack(subId: string, sequence: number): AckResult {
    const sub = this.subscribers.get(subId)
    if (!sub) {
      return { acknowledged: false, newCursor: { lastSequence: 0, sessionId: '' } }
    }
    this.ackedSequences.set(subId, sequence)
    return { acknowledged: true, newCursor: { lastSequence: sequence, sessionId: subId } }
  }

  unsubscribe(subId: string): void {
    this.subscribers.delete(subId)
    this.ackedSequences.delete(subId)
  }

  getEventCount(): number {
    return this.events.length
  }

  getSubscriberCount(): number {
    return this.subscribers.size
  }

  replay(fromSequence: number, toSequence: number): StreamEvent[] {
    return this.events.filter(e => e.sequence > fromSequence && e.sequence <= toSequence)
  }

  dedupeCheck(eventId: string): boolean {
    return this.events.some(e => e.eventId === eventId)
  }

  clear(): void {
    this.events = []
    this.sequenceCounter = 0
    this.ackedSequences.clear()
    this.subscribers.clear()
  }
}
