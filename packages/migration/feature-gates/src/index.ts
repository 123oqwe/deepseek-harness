/**
 * Public type surface of `@deepseek-ai/dsh-feature-gates` (Epic P0-05,
 * Contract stage). Type-only: no runtime export, no `Config` schema, and no
 * `apply(ctx, config)` plugin entry, matching
 * `@deepseek-ai/dsh-trust-kernel`'s own Contract-stage convention -- gate
 * registration/evaluation (Provider stage) and CLI/profile wiring
 * (`--dump-config`, Usage stage) are later slices' deliverables; see
 * `src/invariant.ts` for this package's (currently empty) invariant
 * companion.
 * @module @deepseek-ai/dsh-feature-gates
 */
export type * from './types.ts'
