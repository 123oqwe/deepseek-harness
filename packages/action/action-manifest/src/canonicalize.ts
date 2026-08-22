import { createHash } from 'node:crypto'
import type { ActionManifest, CanonicalizedManifest, ActionRiskLevel } from './types.ts'

export function canonicalizeParameters(params: Record<string, unknown>): string {
  return JSON.stringify(params, Object.keys(params).sort())
}

export function computeDigest(manifest: ActionManifest): string {
  const canonical = [
    manifest.actionId,
    manifest.toolName,
    manifest.principalId,
    manifest.tenantId,
    manifest.runId,
    manifest.canonicalParameters,
    manifest.riskLevel,
    manifest.requiresApproval ? '1' : '0',
    manifest.idempotencyKey ?? '',
  ].join(':')
  return createHash('sha256').update(canonical).digest('hex')
}

export function canonicalize(manifest: ActionManifest): CanonicalizedManifest {
  const canonicalParams = manifest.canonicalParameters || canonicalizeParameters(manifest.parameters)
  const withCanonical = { ...manifest, canonicalParameters: canonicalParams }
  return { ...withCanonical, digest: computeDigest(withCanonical) }
}

export function classifyRisk(toolName: string, params: Record<string, unknown>): ActionRiskLevel {
  if (toolName.includes('delete') || toolName.includes('remove')) return 'irreversible'
  if (toolName.includes('pay') || toolName.includes('transfer')) return 'critical'
  if (toolName.includes('write') || toolName.includes('create')) return 'medium'
  if (toolName.includes('read') || toolName.includes('list')) return 'low'
  return 'medium'
}

export function requiresApproval(risk: ActionRiskLevel): boolean {
  return risk === 'high' || risk === 'critical' || risk === 'irreversible'
}
