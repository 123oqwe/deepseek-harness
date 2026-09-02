/**
 * Package entry point. Per this program's established B4(f) scaffold rule
 * (first exercised at Epic P0-02's `@deepseek-ai/dsh-trust-kernel`, maintainer
 * decision BLOCKED-009): a brand-new package's Contract-stage-only slice
 * carries this file as mandatory scaffold, limited to type re-exports of
 * `./types.ts` — zero runtime exports, zero Cordis registration, zero side
 * effects. This Contract-stage slice's real deliverable is the type
 * contract (`./types.ts`) and its pure validation logic (`./validate.ts`);
 * this file's public surface IS the type half of that deliverable, not a
 * placeholder standing in for one.
 *
 * A later P-stage slice adds this package's real runtime surface (Epic
 * P1-01's `packages/plugin/plugin-manifest/src/index.ts` is a declared
 * P-stage file) — likely a Cordis-facing reader that loads a plugin
 * package's `package.json`, calls `./validate.ts`'s `classifyPluginDeclaration`,
 * and exposes the result to `packages/host/plugin-inventory`. This file
 * intentionally exports no such reader yet.
 *
 * @module @deepseek-ai/dsh-plugin-manifest
 */
export type * from './types.ts'
