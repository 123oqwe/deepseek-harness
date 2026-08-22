import { createHash } from 'node:crypto'

export interface AuditEntry {
  readonly sequence: number
  readonly timestamp: number
  readonly principal: string
  readonly action: string
  readonly resource: string
  readonly outcome: string
  readonly prevHash: string
  readonly hash: string
}

export function computeEntryHash(entry: Omit<AuditEntry, 'hash'>): string {
  const content = JSON.stringify(entry, Object.keys(entry).sort())
  return createHash('sha256').update(content).digest('hex')
}

export class AuditLedger {
  private entries: AuditEntry[] = []
  private lastHash = 'genesis'

  append(input: Omit<AuditEntry, 'sequence' | 'prevHash' | 'hash'>): AuditEntry {
    const sequence = this.entries.length
    const entry: Omit<AuditEntry, 'hash'> = {
      ...input,
      sequence,
      prevHash: this.lastHash,
    }
    const hash = computeEntryHash(entry)
    const fullEntry: AuditEntry = { ...entry, hash }
    this.entries.push(fullEntry)
    this.lastHash = hash
    return fullEntry
  }

  verify(): { valid: boolean; brokenAt?: number; reason?: string } {
    let prevHash = 'genesis'
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!
      if (entry.prevHash !== prevHash) {
        return { valid: false, brokenAt: i, reason: `prevHash mismatch at entry ${i}` }
      }
      const expectedHash = computeEntryHash({ ...entry, hash: undefined } as Omit<AuditEntry, 'hash'>)
      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: i, reason: `hash mismatch at entry ${i}` }
      }
      prevHash = entry.hash
    }
    return { valid: true }
  }

  getEntries(): readonly AuditEntry[] {
    return this.entries
  }

  detectTamper(modifiedIndex: number): { detected: boolean; index: number } {
    // If we tamper with entry at modifiedIndex, all subsequent hashes will be wrong
    const verifyResult = this.verify()
    return {
      detected: !verifyResult.valid,
      index: verifyResult.brokenAt ?? modifiedIndex,
    }
  }
}
