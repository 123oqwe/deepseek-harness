export interface OutboxEntry {
  readonly id: string
  readonly sink: string
  readonly payload: unknown
  readonly enqueuedAt: number
  readonly delivered: boolean
  readonly acked: boolean
  readonly sequence: number
}

export class TelemetryOutbox {
  private entries: OutboxEntry[] = []
  private cursor = 0
  private sequenceCounter = 0
  private ackedIds = new Set<string>()
  private redactionPolicyMounted = false
  private deliveredCount = 0

  setRedactionPolicy(mounted: boolean): void {
    this.redactionPolicyMounted = mounted
  }

  enqueue(sink: string, payload: unknown): { accepted: boolean; reason: string; id?: string } {
    if (!this.redactionPolicyMounted) {
      return { accepted: false, reason: 'No redaction policy mounted; refusing to start shared collector' }
    }
    const id = `out-${++this.sequenceCounter}`
    this.entries.push({
      id, sink, payload, enqueuedAt: Date.now(),
      delivered: false, acked: false, sequence: this.sequenceCounter,
    })
    return { accepted: true, reason: 'Enqueued', id }
  }

  flush(): OutboxEntry[] {
    const pending = this.entries.filter(e => !e.delivered)
    for (const entry of pending) {
      Object.assign(entry, { delivered: true })
      this.deliveredCount++
    }
    return pending
  }

  ack(id: string): boolean {
    const entry = this.entries.find(e => e.id === id)
    if (!entry || !entry.delivered) return false
    if (this.ackedIds.has(id)) return true
    this.ackedIds.add(id)
    this.cursor = Math.max(this.cursor, entry.sequence)
    return true
  }

  getUndelivered(): readonly OutboxEntry[] {
    return this.entries.filter(e => !e.delivered)
  }

  getAckedCount(): number {
    return this.ackedIds.size
  }

  getDeliveredCount(): number {
    return this.deliveredCount
  }

  dedupeCheck(id: string): boolean {
    return this.ackedIds.has(id)
  }

  clear(): void {
    this.entries = []
    this.cursor = 0
    this.sequenceCounter = 0
    this.ackedIds.clear()
    this.deliveredCount = 0
  }
}
