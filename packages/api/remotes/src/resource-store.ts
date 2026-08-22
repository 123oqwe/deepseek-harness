// @ts-expect-error: cross-project import, typert regeneration needed
import type { ResourceSummary, ResourceDetail, PaginationParams, PaginatedResult, ConcurrencyToken } from '../../../sdk/protocol/src/resources.ts'

export class ResourceStore<T extends ResourceSummary> {
  private items = new Map<string, T & { data?: unknown }>()
  private watchers: ((event: { type: string; resource?: T; id?: string }) => void)[] = []

  create(item: T & { data?: unknown }): T {
    this.items.set(item.id, item)
    this.notify({ type: 'created', resource: item })
    return item
  }

  get(id: string, tenantId: string): ResourceDetail | undefined {
    const item = this.items.get(id)
    if (!item || item.tenantId !== tenantId) return undefined
    return { ...item, data: item.data ?? null }
  }

  list(params: PaginationParams, tenantId: string): PaginatedResult<T> {
    let items = Array.from(this.items.values()).filter(i => i.tenantId === tenantId)
    if (params.filter) {
      for (const [key, value] of Object.entries(params.filter)) {
        items = items.filter(i => String((i as Record<string, unknown>)[key] ?? '') === value)
      }
    }
    const total = items.length
    const limit = params.limit ?? 50
    let startIdx = 0
    if (params.cursor) {
      const cursorIdx = items.findIndex(i => i.id === params.cursor)
      if (cursorIdx >= 0) startIdx = cursorIdx + 1
    }
    const page = items.slice(startIdx, startIdx + limit)
    const nextCursor = startIdx + limit < total ? page[page.length - 1]?.id : undefined
    return { items: page, nextCursor, total }
  }

  update(id: string, data: unknown, token: ConcurrencyToken, tenantId: string): T | undefined {
    const existing = this.items.get(id)
    if (!existing || existing.tenantId !== tenantId) return undefined
    if (existing.revision !== token.expectedRevision) return undefined
    const updated = { ...existing, data, revision: existing.revision + 1, updatedAt: new Date().toISOString() }
    this.items.set(id, updated)
    this.notify({ type: 'updated', resource: updated })
    return updated
  }

  delete(id: string, tenantId: string): boolean {
    const item = this.items.get(id)
    if (!item || item.tenantId !== tenantId) return false
    this.items.delete(id)
    this.notify({ type: 'deleted', id })
    return true
  }

  watch(callback: (event: { type: string; resource?: T; id?: string }) => void): () => void {
    this.watchers.push(callback)
    return () => { this.watchers = this.watchers.filter(w => w !== callback) }
  }

  private notify(event: { type: string; resource?: T; id?: string }): void {
    for (const watcher of this.watchers) watcher(event)
  }

  clear(): void {
    this.items.clear()
    this.watchers = []
  }
}
