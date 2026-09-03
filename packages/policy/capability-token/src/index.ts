/**
 * Package entry point. Re-exports the public surface of Epic P2-02's
 * attenuable capability tokens: the token/lineage types and branded
 * identifiers ({@link ./types}), and the issuance, verification,
 * attenuation, revocation, and audit-redaction functions
 * ({@link ./attenuate}).
 *
 * @module @deepseek-ai/dsh-capability-token
 */
export * from './types.ts'
export * from './attenuate.ts'
