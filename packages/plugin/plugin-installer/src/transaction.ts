import type { QuarantineEntry } from './quarantine.ts'

export interface InstallTransaction {
  readonly id: string
  readonly entries: QuarantineEntry[]
  readonly state: 'in-progress' | 'committed' | 'aborted'
  readonly startedAt: string
  readonly completedAt?: string
}

export function beginTransaction(): InstallTransaction {
  return { id: crypto.randomUUID(), entries: [], state: 'in-progress', startedAt: new Date().toISOString() }
}

export function addEntry(tx: InstallTransaction, entry: QuarantineEntry): InstallTransaction {
  return { ...tx, entries: [...tx.entries, entry] }
}

export function commit(tx: InstallTransaction): InstallTransaction {
  for (const entry of tx.entries) {
    if (entry.state !== 'installed' && entry.state !== 'verified') {
      throw new Error(`Cannot commit: entry ${entry.pluginName} is ${entry.state}`)
    }
  }
  return { ...tx, state: 'committed', completedAt: new Date().toISOString() }
}

export function abort(tx: InstallTransaction): InstallTransaction {
  return { ...tx, state: 'aborted', completedAt: new Date().toISOString() }
}
