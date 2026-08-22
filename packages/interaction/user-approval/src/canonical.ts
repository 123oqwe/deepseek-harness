import { createHash } from 'node:crypto'

export interface ApprovalRequest {
  readonly id: string
  readonly actionManifestDigest: string
  readonly redactedParameters: Record<string, unknown>
  readonly resources: string[]
  readonly riskLevel: string
  readonly expectedDiff?: string
  readonly validFrom: string
  readonly validUntil: string
  readonly capabilityTokenId?: string
  readonly policyVersion: string
}

function deepSort(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(deepSort)
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = deepSort((obj as Record<string, unknown>)[key])
  }
  return sorted
}

export function canonicalizeApproval(req: Omit<ApprovalRequest, 'id'>): ApprovalRequest {
  const sorted = deepSort(req) as Record<string, unknown>
  const json = JSON.stringify(sorted)
  return { ...req, id: createHash('sha256').update(json).digest('hex') }
}

export function verifyDigest(req: ApprovalRequest, expectedDigest: string): boolean {
  const { id: _id, ...rest } = req
  const sorted = deepSort(rest) as Record<string, unknown>
  const computed = createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
  return computed === expectedDigest
}

export function isExpired(req: ApprovalRequest, now: Date = new Date()): boolean {
  return new Date(req.validUntil) < now
}

export function redactSensitive(params: Record<string, unknown>, sensitiveKeys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitive(value as Record<string, unknown>, sensitiveKeys)
    } else {
      result[key] = value
    }
  }
  return result
}
