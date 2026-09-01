/**
 * Package entry point. Maintainer decision BLOCKED-009 (2026-09-01): a
 * brand-new package's C-stage-only slice carries this file as mandatory
 * B4(f) scaffold, limited to type re-exports of `./types.ts` -- zero
 * runtime exports, zero Cordis registration, zero side effects. C-stage's
 * real deliverable is the type contract; this file's public surface IS
 * that deliverable, not a placeholder standing in for one.
 *
 * A later U-stage slice replaces or extends this file with the real
 * `TrustKernel` construction and `ctx.provide('trustKernel', kernel)`
 * wiring (see `./types.ts`'s own doc comment) -- that slice's Reviewer
 * checks this file was genuinely superseded, not left orphaned beside new
 * construction logic added elsewhere.
 *
 * @module @deepseek-ai/dsh-trust-kernel
 */
export type * from './types.ts'
