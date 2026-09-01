/**
 * Boot-time preflight gate for P0-01's MUST clause ("verify must run before
 * any execution batch begins; on drift, stop"). RED-stage no-behavior stub
 * (B4(f)/B5): registers the real plugin shape but performs no drift check
 * yet, so the U-stage contract tests fail today on a genuine behavioral
 * mismatch (boot never aborts on drift), never on MODULE_NOT_FOUND/SyntaxError.
 * The real check is a separate, later GREEN commit for this same slice.
 * @module @deepseek-ai/dsh-baseline-preflight
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'baseline-preflight'

/** Plugin config: which checkout to verify against its captured baseline. */
export interface Config {
  /**
   * Checkout root to verify (default: `process.cwd()`), matching
   * `--repo-root` on `scripts/release/baseline-fingerprint.mjs`.
   */
  repoRoot?: string
}

export const Config: z<Config> = z.object({
  // No schema default: process.cwd() is resolved in `apply` so the checked
  // root is always the actual boot cwd unless a deployment overrides it.
  repoRoot: z.string(),
})

/**
 * RED-stage stub: no drift check is performed yet.
 * @param ctx - unused; declared for the Cordis plugin `apply(ctx, config)` shape.
 * @param config - unused in this stub; declared for the real shape.
 */
export async function apply(_ctx: Context, _config: Config): Promise<void> {}
