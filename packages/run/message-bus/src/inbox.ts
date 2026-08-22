export interface InboxMessage {
  readonly id: string
  readonly runId: string
  readonly type: string
  readonly payload: unknown
  readonly receivedAt: string
  readonly processed: boolean
}

export class Inbox {
  private messages: InboxMessage[] = []
  private processedIds = new Set<string>()

  enqueue(msg: Omit<InboxMessage, 'id' | 'receivedAt' | 'processed'>): InboxMessage {
    const full: InboxMessage = {
      ...msg,
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      processed: false,
    }
    this.messages.push(full)
    return full
  }

  dequeue(): InboxMessage | undefined {
    const unprocessed = this.messages.find(m => !m.processed)
    if (!unprocessed) return undefined
    return unprocessed
  }

  markProcessed(id: string): void {
    if (this.processedIds.has(id)) return
    this.processedIds.add(id)
    const msg = this.messages.find(m => m.id === id)
    if (msg) {
      const idx = this.messages.indexOf(msg)
      this.messages[idx] = { ...msg, processed: true }
    }
  }

  isProcessed(id: string): boolean {
    return this.processedIds.has(id)
  }

  get pending(): number {
    return this.messages.filter(m => !m.processed).length
  }

  get all(): InboxMessage[] {
    return [...this.messages]
  }

  clear(): void {
    this.messages = []
    this.processedIds.clear()
  }
}
