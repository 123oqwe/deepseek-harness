/**
 * The trust anchors a profile admits for plugin provenance (Epic P1-02
 * must[2]): read from the profile's own `package.json` `dsh.trustAnchors`, so
 * `dsh plugin add` and the profile's boot build their trust kernel from the
 * same field. The reader lives in `@deepseek-ai/dsh-app-boot`, shared with the
 * Desktop Host; this module re-exports it so the CLI's callers keep importing
 * it from here.
 * @module @deepseek-ai/dsh/trust-anchors
 */

export { readProfileTrustAnchors } from '@deepseek-ai/dsh-app-boot'
