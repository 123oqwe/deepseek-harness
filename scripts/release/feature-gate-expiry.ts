/**
 * Epic P0-05 acceptance[2]'s release-gate wiring: an expired feature gate
 * must fail in a genuine release gate. `scripts/release/verify.ts` --
 * `pnpm run release:verify`, run for every `dsh` family release from GitHub
 * Actions (see that file's own module doc) -- is the repository's real,
 * pre-existing release gate that already checks the same version scheme
 * `FeatureGateDeclaration.removalVersion` is defined against (the `dsh`
 * family's one shared version, synced to root `package.json`); this file is
 * that check, kept separate from `apps/cli/src/profile-boot.ts`'s own
 * `FEATURE_GATE_DECLARATIONS` because `apps/cli` (`@deepseek-ai/dsh`) is a
 * bin-only package with no export surface (`exports: null` in its
 * `package.json`) other code may import, and this repository's convention
 * requires cross-package imports to go through a package name, never a
 * relative path across a package boundary. A future epic that declares a
 * real capability gate registers it in both lists.
 *
 * P0-07's `collect-evidence.mjs`/`verify-evidence.mjs` were considered and
 * rejected as the integration point: their "gate" is a first100-registry
 * gate command's captured output, an unrelated domain from a feature gate's
 * lifecycle -- wiring this there would coincidentally couple two unrelated
 * mechanisms and read as scope creep past this epic's own boundary.
 * @module scripts/release/feature-gate-expiry
 */

import { checkFeatureGateExpiry } from '@deepseek-ai/dsh-feature-gates'
import type { FeatureGateDeclaration } from '@deepseek-ai/dsh-feature-gates'

/**
 * The release gate's own declared feature gates. Empty: no major capability
 * in this repository has migrated behind a gate yet (matching
 * `apps/cli/src/profile-boot.ts`'s own `FEATURE_GATE_DECLARATIONS` and
 * `@deepseek-ai/dsh-feature-gates`'s Known Limitations) -- so this check
 * runs for real on every `dsh` family release but has nothing to fail
 * against today.
 */
export const RELEASE_GATE_FEATURE_GATES: readonly FeatureGateDeclaration[] = []

/**
 * Fail the release gate when any declared feature gate has passed its
 * `removalVersion` for the version under release (Epic P0-05 acceptance[2]).
 * @param declarations - the declared gates to check; the release gate calls
 * this with {@link RELEASE_GATE_FEATURE_GATES}.
 * @param releaseVersion - the `dsh` family version under release.
 * @throws when one or more declarations are `'expired'` against `releaseVersion`, naming every one.
 */
export function assertNoExpiredFeatureGates(
  declarations: readonly FeatureGateDeclaration[],
  releaseVersion: string,
): void {
  const expired = declarations.filter(gate => checkFeatureGateExpiry(gate, releaseVersion) === 'expired')
  if (expired.length === 0) return
  const detail = expired.map(gate => `${gate.id} (removalVersion ${gate.removalVersion}, owner ${gate.owner})`).join('\n')
  throw new Error(`release gate: ${String(expired.length)} feature gate(s) past their removalVersion for ${releaseVersion}:\n${detail}`)
}
