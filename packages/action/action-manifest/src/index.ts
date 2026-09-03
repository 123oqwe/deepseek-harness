/**
 * Package entry point barrel. Standard package-registration infra, not
 * itself part of Epic P2-03's Contract-stage deliverable: every
 * Contract-stage type and decision function is defined and
 * documented in `./types.ts`/`./canonicalize.ts`, which this file only
 * re-exports (`./canonicalize.ts` already re-exports `./types.ts` in full).
 * Registry `stages.C.files` for P2-03 does not list this file;
 * `stages.U.files` does — a later Usage-stage Consumer adds the real
 * tool-dispatch wiring here.
 *
 * @module @deepseek-ai/dsh-action-manifest
 */
export * from './canonicalize.ts'
