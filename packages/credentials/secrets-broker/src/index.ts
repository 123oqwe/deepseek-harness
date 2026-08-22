export type { CredentialRef, SecretLeaseId, SecretLease } from './types.ts'
export { issueLease, revokeLease, getLease, isExpired, getActiveLeases, revokeAllForWorld, clearLeases } from './lease.ts'
