export interface OutboxMessage {
  readonly id: string
  readonly runId: string
  readonly type: string
  readonly payload: unknown
  readonly createdAt: string
  readonly delivered: boolean
  readonly deliveredAt?: string
  readonly deliverAttempts: number
}

export class Outbox {
  private messages: OutboxMessage[] = []
  private deliveredIds = new Set<string>()

  enqueue(msg: Omit<OutboxMessage, 'id' | 'createdAt' | 'delivered' | 'deliverAttempts'>): OutboxMessage {
    const full: OutboxMessage = {
      ...msg,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      delivered: false,
      deliverAttempts: 0,
    }
    this.messages.push(full)
    return full
  }

  getUndelivered(): OutboxMessage[] {
    return this.messages.filter(m => !m.delivered)
  }

  markDelivered(id: string): void {
    if (this.deliveredIds.has(id)) return
    this.deliveredIds.add(id)
    const msg = this.messages.find(m => m.id === id)
    if (msg) {
      const idx = this.messages.indexOf(msg)
      this.messages[idx] = { ...msg, delivered: true, deliveredAt: new Date().toISOString() }
    }
  }

  incrementAttempts(id: string): void {
    const msg = this.messages.find(m => m.id === id)
    if (msg && !msg.delivered) {
      const idx = this.messages.indexOf(msg)
      this.messages[idx] = { ...msg, deliverAttempts: msg.deliverAttempts + 1 }
    }
  }

  isDelivered(id: string): boolean {
    return this.deliveredIds.has(id)
  }

  get pending(): number {
    return this.messages.filter(m => !m.delivered).length
  }

  clear(): void {
    this.messages = []
    this.deliveredIds.clear()
  }
}
