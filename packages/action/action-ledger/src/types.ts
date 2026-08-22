export type LedgerState = 'prepared' | 'sent' | 'confirmed' | 'ambiguous' | 'compensated'

export interface LedgerEntry {
  readonly idempotencyKey: string
  readonly actionManifestDigest: string
  readonly providerId: string
  readonly externalTarget: string
  readonly state: LedgerState
  readonly createdAt: string
  readonly sentAt?: string
  readonly confirmedAt?: string
  readonly result?: unknown
  readonly compensatedAt?: string
  readonly compensationReason?: string
}
