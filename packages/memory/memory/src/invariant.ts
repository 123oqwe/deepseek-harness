import type { MemoryRecord, MemoryQuery } from './types.ts'

export function validateRecord(record: Partial<MemoryRecord>): string[] {
  const errors: string[] = []
  if (!record.principalId) errors.push('principalId is required')
  if (!record.tenantId) errors.push('tenantId is required')
  if (!record.content) errors.push('content is required')
  if (!record.source) errors.push('source is required')
  if (record.confidence !== undefined && (record.confidence < 0 || record.confidence > 1)) {
    errors.push('confidence must be between 0 and 1')
  }
  if (!record.scope) errors.push('scope is required')
  if (!record.purpose) errors.push('purpose is required')
  return errors
}

export function isExpired(record: MemoryRecord): boolean {
  if (!record.expiresAt) return false
  return new Date(record.expiresAt) < new Date()
}

export function matchesQuery(record: MemoryRecord, query: MemoryQuery): boolean {
  if (record.tenantId !== query.tenantId) return false
  if (query.principalId && record.principalId !== query.principalId) return false
  if (query.scope && record.scope !== query.scope) return false
  if (query.filter && !record.content.includes(query.filter)) return false
  if (isExpired(record)) return false
  return true
}
