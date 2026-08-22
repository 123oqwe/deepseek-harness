import type { Branded } from '@deepseek-ai/dsh-brand'

export type CredentialRef = Branded<'CredentialRef'>
export type SecretLeaseId = Branded<'SecretLeaseId'>

export interface SecretLease {
  readonly id: SecretLeaseId
  readonly credentialRef: CredentialRef
  readonly principalId: string
  readonly actionManifestDigest: string
  readonly worldId: string
  readonly purpose: string
  readonly expiry: string
  readonly issuedAt: string
  readonly revoked: boolean
  readonly injectionMethod: 'env' | 'fd' | 'socket' | 'file'
}
