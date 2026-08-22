import { createHash } from 'node:crypto'

export interface Attestation {
  readonly imageDigest: string
  readonly policyDigest: string
  readonly tenantId: string
  readonly networkProxyVerified: boolean
  readonly secretInjectionVerified: boolean
  readonly attestedAt: string
  readonly valid: boolean
}

export function createAttestation(opts: {
  imageDigest: string
  policyDigest: string
  tenantId: string
  networkProxyVerified: boolean
  secretInjectionVerified: boolean
}): Attestation {
  const valid = opts.networkProxyVerified && opts.secretInjectionVerified
  return { ...opts, attestedAt: new Date().toISOString(), valid }
}

export function verifyAttestation(attestation: Attestation, expectedImageDigest: string, expectedTenantId: string): boolean {
  if (!attestation.valid) return false
  if (attestation.imageDigest !== expectedImageDigest) return false
  if (attestation.tenantId !== expectedTenantId) return false
  return true
}

export function computeImageDigest(imageData: Uint8Array): string {
  return createHash('sha256').update(imageData).digest('hex')
}
