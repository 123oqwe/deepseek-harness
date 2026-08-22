import type { LedgerEntry, LedgerState } from './types.ts'

const ledger = new Map<string, LedgerEntry>()

export function prepare(opts: Omit<LedgerEntry, 'state' | 'createdAt'>): LedgerEntry {
  if (ledger.has(opts.idempotencyKey)) {
    const existing = ledger.get(opts.idempotencyKey)
    if (existing && existing.state === 'confirmed') {
      return existing
    }
  }
  const entry: LedgerEntry = { ...opts, state: 'prepared', createdAt: new Date().toISOString() }
  ledger.set(opts.idempotencyKey, entry)
  return entry
}

export function markSent(key: string): LedgerEntry {
  const entry = ledger.get(key)
  if (!entry) throw new Error(`Ledger entry not found: ${key}`)
  const updated: LedgerEntry = { ...entry, state: 'sent', sentAt: new Date().toISOString() }
  ledger.set(key, updated)
  return updated
}

export function markConfirmed(key: string, result: unknown): LedgerEntry {
  const entry = ledger.get(key)
  if (!entry) throw new Error(`Ledger entry not found: ${key}`)
  const updated: LedgerEntry = { ...entry, state: 'confirmed', confirmedAt: new Date().toISOString(), result }
  ledger.set(key, updated)
  return updated
}

export function markAmbiguous(key: string): LedgerEntry {
  const entry = ledger.get(key)
  if (!entry) throw new Error(`Ledger entry not found: ${key}`)
  const updated: LedgerEntry = { ...entry, state: 'ambiguous' }
  ledger.set(key, updated)
  return updated
}

export function compensate(key: string, reason: string): LedgerEntry {
  const entry = ledger.get(key)
  if (!entry) throw new Error(`Ledger entry not found: ${key}`)
  const updated: LedgerEntry = { ...entry, state: 'compensated', compensatedAt: new Date().toISOString(), compensationReason: reason }
  ledger.set(key, updated)
  return updated
}

export function getEntry(key: string): LedgerEntry | undefined {
  return ledger.get(key)
}

export function getByState(state: LedgerState): LedgerEntry[] {
  return Array.from(ledger.values()).filter(e => e.state === state)
}

export function isConfirmed(key: string): boolean {
  return ledger.get(key)?.state === 'confirmed'
}

export function clearLedger(): void {
  ledger.clear()
}
