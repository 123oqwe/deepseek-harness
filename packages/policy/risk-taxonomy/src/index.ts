/**
 * Type-only barrel for the risk taxonomy (P2-04 C stage).
 *
 * Exactly one statement, and it re-exports types only. The repository's root
 * `tsdown.config.ts` builds every workspace package against a fixed entry
 * glob with no per-package exclusion, so a package directory without an
 * `index.ts` fails the build the moment it exists — this file is the scaffold
 * that requirement forces (BLOCKED-131, B4(f)).
 *
 * The runtime exports belong to the Provider stage. Keeping this barrel
 * type-only is what makes the Contract stage a contract rather than an
 * implementation: nothing re-exported here can execute.
 *
 * @module @deepseek-ai/dsh-risk-taxonomy
 */
export type * from './types.ts'
