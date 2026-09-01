/**
 * Boot-time preflight gate for P0-01's MUST clause ("verify must run before
 * any execution batch begins; on drift, stop"): when the booting checkout has
 * a captured baseline (`pnpm baseline:capture`, `<repoRoot>/.dsh/baseline.json`)
 * that no longer matches its working tree, `apply` throws with the drifted
 * path(s) named, which propagates through Cordis fiber activation and aborts
 * application startup ({@link boot} in `@deepseek-ai/dsh-app-boot`).
 *
 * A checkout with no captured baseline is not yet enrolled in the scheme —
 * `pnpm baseline:capture` is the separate bootstrapping step this gate does
 * not perform — and boots unaffected, so the plugin stays safe as a default
 * row for `repoRoot` values (an arbitrary end-user project directory, an
 * unrelated test fixture) that have nothing to verify.
 *
 * `scripts/release/baseline-fingerprint.mjs` is repo-internal tooling —
 * never part of this package's published `files` — so it exists only inside
 * this monorepo's own source tree, never in a packed/installed consumer of
 * `@deepseek-ai/dsh-baseline-preflight`. The gate is therefore meaningfully
 * active only when running from within this checkout; if the script cannot
 * be resolved at all, that is treated exactly like "nothing captured to
 * verify against" (a scoping fact, not a swallowed drift signal — no
 * verification is ever attempted, so no drift can be silently missed).
 * @module @deepseek-ai/dsh-baseline-preflight
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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

/** One drifted field, as reported by `scripts/release/baseline-fingerprint.mjs`'s `verifyBaseline`. */
interface DriftEntry {
  readonly path: string
  readonly field: string
  readonly expected: unknown
  readonly actual: unknown
}

/** The shape `verifyBaseline` returns. */
interface VerifyBaselineResult {
  readonly ok: boolean
  readonly drift: readonly DriftEntry[]
}

/** The one export this plugin uses from the dynamically imported script. */
interface BaselineFingerprintModule {
  verifyBaseline(repoRoot: string): VerifyBaselineResult
}

/**
 * Load this harness checkout's own `scripts/release/baseline-fingerprint.mjs`
 * — the single source of truth `pnpm baseline:verify` also runs. A dynamic
 * import built from a computed URL, rather than a static specifier, keeps
 * this plain-JS repo-tooling script (outside every package's TypeScript
 * project, so it has no ambient types) from requiring a project reference;
 * the result is narrowed once, here, against {@link BaselineFingerprintModule}.
 * @returns the module's `verifyBaseline` export, or `undefined` when the
 * script cannot be resolved at all — a packed/installed consumer, where
 * `scripts/` does not exist alongside this plugin's own module (see the
 * module-level doc comment).
 */
async function loadBaselineFingerprintModule(): Promise<BaselineFingerprintModule | undefined> {
  const scriptUrl = new URL('../../../../scripts/release/baseline-fingerprint.mjs', import.meta.url)
  try {
    // A non-literal import() specifier types as `any`; absorb it into
    // `unknown` first (an `any` value, unlike a concretely-typed one, is
    // otherwise an unsafe assignment even into an annotated variable), then
    // narrow to this module's one used export — the one place this untyped
    // runtime boundary is narrowed.
    const raw: unknown = await import(scriptUrl.href)
    return raw as BaselineFingerprintModule
  } catch {
    // Only the import() resolution step is inside this try — never
    // `verifyBaseline` itself, so a genuine drift/misconfiguration error from
    // the loaded module is never caught here and always propagates.
    return undefined
  }
}

/** Render the drift list the same way `pnpm baseline:verify` reports it, for a thrown error naming every drifted path. */
function formatDrift(drift: readonly DriftEntry[]): string {
  const lines = drift.map(entry =>
    `  ${entry.path} (${entry.field}): expected ${JSON.stringify(entry.expected)}, found ${JSON.stringify(entry.actual)}`)
  return `baseline-preflight: checkout has drifted from its captured baseline (rerun \`pnpm baseline:capture\` once the drift is confirmed intentional):\n${lines.join('\n')}`
}

/**
 * Verify the checkout against its captured baseline and throw when it has
 * drifted, aborting Cordis Loader activation — and therefore application
 * boot — with the drifted path(s) in the message. A checkout with no captured
 * baseline at `<repoRoot>/.dsh/baseline.json`, or where the verification
 * tooling itself cannot be resolved (a packed/installed consumer), has
 * nothing to verify against and is left alone.
 * @param ctx - unused; declared for the Cordis plugin `apply(ctx, config)` shape.
 * @param config - validated {@link Config}.
 * @throws when the checkout's working tree has drifted from its captured baseline.
 */
export async function apply(_ctx: Context, config: Config): Promise<void> {
  const repoRoot = config.repoRoot ?? process.cwd()
  if (!existsSync(join(repoRoot, '.dsh/baseline.json'))) return
  const mod = await loadBaselineFingerprintModule()
  if (mod === undefined) return
  const result = mod.verifyBaseline(repoRoot)
  if (!result.ok) throw new Error(formatDrift(result.drift))
}
