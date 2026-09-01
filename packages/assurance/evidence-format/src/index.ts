/**
 * Package entry point. Per this program's established B4(f) scaffold rule
 * (first exercised at Epic P0-02's `@deepseek-ai/dsh-trust-kernel`, maintainer
 * decision BLOCKED-009): a brand-new package's Contract-stage-only slice
 * carries this file as mandatory scaffold, limited to type re-exports of
 * `./types.ts` — zero runtime exports, zero Cordis registration, zero side
 * effects. This Contract-stage slice's real deliverable is the type
 * contract; this file's public surface IS that deliverable, not a
 * placeholder standing in for one.
 *
 * A later P-stage slice adds `scripts/release/collect-evidence.mjs` and
 * `scripts/release/verify-evidence.mjs` — the producer/verifier that
 * construct and check `EvidencePackage` values. This package intentionally
 * exports no constructor of its own: every value described by `./types.ts`
 * is external data (evidence collected by a release run, later parsed and
 * verified), not something this package builds.
 *
 * @module @deepseek-ai/dsh-evidence-format
 */
export type * from './types.ts'
