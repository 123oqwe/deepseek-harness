import { createHash } from 'node:crypto'

export function normalizeProjection(events: readonly unknown[]): string {
  const normalized = JSON.stringify(events.map(e => JSON.stringify(e)).sort())
  return createHash('sha256').update(normalized).digest('hex')
}

export function normalizePolicyDecisions(decisions: readonly unknown[]): string {
  const normalized = JSON.stringify(decisions.map(d => JSON.stringify(d)).sort())
  return createHash('sha256').update(normalized).digest('hex')
}

export function compareNormalized(a: string, b: string): boolean {
  return a === b
}
