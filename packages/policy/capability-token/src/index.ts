export type { CapabilityTokenId, CapabilityToken, TokenConstraints } from './types.ts'
export { TokenExpiredError, TokenAttenuationError } from './types.ts'
export { issueToken, attenuateToken, getToken, isExpired, hasCapability, clearTokens } from './attenuate.ts'
