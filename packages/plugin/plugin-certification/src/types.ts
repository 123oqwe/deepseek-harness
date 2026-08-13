export type TrustLevel = 'L0-unknown' | 'L1-inspected' | 'L2-signed' | 'L3-verified' | 'L4-production' | 'L5-kernel-trusted'

export interface CertificationCheck {
  readonly name: string
  readonly passed: boolean
  readonly details: string
}

export interface CertificationReport {
  readonly pluginDigest: string
  readonly trustLevel: TrustLevel
  readonly checks: readonly CertificationCheck[]
  readonly timestamp: number
  readonly bindingDigest: string
}
