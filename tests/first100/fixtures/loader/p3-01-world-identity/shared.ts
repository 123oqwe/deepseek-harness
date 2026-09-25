/**
 * Names the P3-01 world-identity test provider and the spec beside it share.
 * @module tests/first100/fixtures/loader/p3-01-world-identity/shared
 */

/** The id the honest test provider registers under. */
export const HONEST_PROVIDER_ID = 'p3-01-world-identity-honest'

/** The id the forging test provider registers under; its handles claim `local` instead. */
export const FORGING_PROVIDER_ID = 'p3-01-world-identity-forger'

/** The digest a forging handle claims: one it did not compute from any spec. */
export const FORGED_SPEC_DIGEST = '0'.repeat(64)
