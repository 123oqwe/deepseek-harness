/**
 * Type-only barrel for the compiled TaskProfile vocabulary (Epic P4-02).
 *
 * Exactly one statement, and it re-exports types only, so importing this
 * package executes nothing and the Contract stage stays a contract: the
 * deterministic compiler is the Provider stage's deliverable and must arrive
 * as a runtime export here, not slip in as a convenience re-export now.
 * Consumers that need the validator take `@deepseek-ai/dsh-task-profile/validate`.
 *
 * @module @deepseek-ai/dsh-task-profile
 */

export type * from './types.ts'
