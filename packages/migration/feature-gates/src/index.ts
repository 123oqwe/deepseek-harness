/**
 * Provider-stage runtime for Epic P0-05 (Shadow/Enforce feature gates):
 *
 * - {@link resolveFeatureGate} -- must[3]'s `--dump-config` override-chain
 *   resolution: default -> profile -> settings -> env, in ascending
 *   precedence. Pure over a {@link FeatureGateDeclaration} and the
 *   {@link FeatureGateNamespaceValue} shape a real
 *   `packages/settings/settings/src/index.ts`'s
 *   `SettingsProvider.register('feature-gates', schema).get()` would hand a
 *   caller (that provider's `resolve()` always `deepFreeze`s the value a
 *   `SettingsScope<T>.get()` returns, so this function only ever reads it).
 * - {@link evaluateFeatureGate} -- must[1]: in `shadow` mode both decisions
 *   run, but only `legacy`'s value is ever applied (acceptance[0]: `off` and
 *   `shadow` apply the identical value for the same `legacy`/`candidate`
 *   pair), and a redacted diff is recorded (acceptance[1]).
 * - {@link redactDecisionSummary} -- the real redaction call site
 *   {@link RedactedJsonValue}'s own doc comment calls for: a fixed field
 *   allowlist, not a bare cast.
 * - {@link checkFeatureGateExpiry} -- acceptance[2]'s release-gate check,
 *   against a real SemVer-precedence version comparison.
 *
 * Deliberately out of scope: no gate is declared here for any real
 * capability (the policy/plugin-trust/run-journal shadow fixtures this
 * epic's own `validation` clause calls for are Composition-stage's
 * deliverable, not this Provider-stage slice's), and nothing here reaches a
 * Cordis plugin surface, a settings-namespace registration, or
 * `--dump-config` itself -- registering the `feature-gates` settings
 * namespace and wiring `apps/cli/src/dump-config.ts` to render
 * {@link FeatureGateResolution} are Usage-stage's declared files.
 *
 * @module @deepseek-ai/dsh-feature-gates
 */
export type * from './types.ts'

import { assertNever, deepEqualJson } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  FeatureGateDeclaration,
  FeatureGateExpiryCheck,
  FeatureGateId,
  FeatureGateNamespaceValue,
  FeatureGateOverrideEntry,
  FeatureGateResolution,
  FeatureGateShadowDecisionRecord,
  FeatureGateState,
  RedactedJsonValue,
} from './types.ts'

/** Higher-precedence override candidates layered above a declaration's own `defaultByProfile` (Epic P0-05 must[3]). */
export interface FeatureGateOverrideInputs {
  /**
   * The real `feature-gates` settings-namespace value, i.e. what
   * `packages/settings/settings/src/index.ts`'s
   * `SettingsProvider.register('feature-gates', schema).get()` returns to a
   * caller. Absence of this gate's id inside it means the namespace carries
   * no override for it, not that it resolves to a falsy state.
   */
  readonly settings?: FeatureGateNamespaceValue
  /** The highest-precedence CLI/environment override, when one was supplied. */
  readonly env?: FeatureGateState
}

/**
 * Resolve one gate's final state and full override chain for `--dump-config`
 * (Epic P0-05 must[3]). Layers, lowest precedence first: the declaration's
 * own `defaultByProfile.default`; `defaultByProfile[profile]`, only when
 * `profile` is not `'default'` and the declaration carries an explicit key
 * for it; `overrides.settings[declaration.id]`, only when the namespace
 * value carries this gate's id; `overrides.env`, when supplied. A layer with
 * no candidate for this gate contributes no chain entry -- the chain shows
 * exactly what actually fed the resolution, never a placeholder for a layer
 * that had nothing to say.
 * @param declaration - the gate's fixed lifecycle metadata (must[2]).
 * @param profile - the active `dsh --profile` name.
 * @param overrides - the settings/env candidates above the declaration's own defaults.
 * @returns the winning source/value and the complete override chain, lowest-precedence first.
 */
export function resolveFeatureGate(
  declaration: FeatureGateDeclaration,
  profile: string,
  overrides: FeatureGateOverrideInputs = {},
): FeatureGateResolution {
  let resolved: FeatureGateOverrideEntry = { source: 'default', value: declaration.defaultByProfile.default }
  const chain: FeatureGateOverrideEntry[] = [resolved]
  const { [profile]: profileValue } = declaration.defaultByProfile
  if (profile !== 'default' && profileValue !== undefined) {
    resolved = { source: 'profile', value: profileValue }
    chain.push(resolved)
  }
  const { [declaration.id]: settingsValue } = overrides.settings ?? {}
  if (settingsValue !== undefined) {
    resolved = { source: 'settings', value: settingsValue }
    chain.push(resolved)
  }
  if (overrides.env !== undefined) {
    resolved = { source: 'env', value: overrides.env }
    chain.push(resolved)
  }
  return { gateId: declaration.id, resolved, chain }
}

/**
 * Redact one decision summary to a fixed field allowlist before it may enter
 * a {@link FeatureGateShadowDecisionRecord} (Epic P0-05 acceptance[1]): a
 * real runtime strip, not merely {@link RedactedJsonValue}'s type-level
 * cast. Any field outside `keepFields` -- a raw request parameter, secret,
 * or other sensitive value a caller's summary object happens to carry -- is
 * dropped before the cast, so "no sensitive parameter leak" holds for the
 * actual value, not just its type.
 * @param summary - the raw decision summary a caller built from its own decision logic.
 * @param keepFields - the fixed set of field names safe to record; every other field is dropped.
 * @returns a {@link RedactedJsonValue} carrying only the allowlisted fields `summary` actually has.
 */
export function redactDecisionSummary(
  summary: Readonly<Record<string, JsonValue>>,
  keepFields: readonly string[],
): RedactedJsonValue {
  const redacted: Record<string, JsonValue> = {}
  for (const field of keepFields) {
    const { [field]: value } = summary
    if (value !== undefined) redacted[field] = value
  }
  return redacted as RedactedJsonValue
}

/** One mode's decision outcome: the value a caller would apply, and a JSON-shaped summary for {@link evaluateFeatureGate}'s shadow diff. */
export interface FeatureGateDecisionOutcome<T> {
  /** The value this mode's decision logic produces. */
  readonly value: T
  /** JSON-shaped decision summary; only the fields {@link evaluateFeatureGate}'s `keepFields` allowlists ever leave this module. */
  readonly summary: Readonly<Record<string, JsonValue>>
}

/** {@link evaluateFeatureGate}'s result: the value the caller must apply, and the shadow diff when one was recorded. */
export interface FeatureGateEvaluation<T> {
  /** The value the caller must apply -- see {@link evaluateFeatureGate}'s own must[1] guarantee. */
  readonly value: T
  /** Present only when `state` was `'shadow'`: the legacy/candidate decision diff. */
  readonly shadowRecord?: FeatureGateShadowDecisionRecord
}

/**
 * Run one gate's decision logic under its resolved state (Epic P0-05
 * must[1] / acceptance[0] / acceptance[1]).
 *
 * `'off'` calls only `legacy` and applies its value; `candidate` never runs.
 * `'enforce'` calls only `candidate` and applies its value; `legacy` never
 * runs. `'shadow'` calls BOTH -- must[1]'s "executes its decision logic" --
 * but always applies `legacy`'s value, which is exactly what proves
 * acceptance[0]: for the same `legacy`/`candidate` pair (the same request),
 * `evaluateFeatureGate(id, 'off', ...).value` and
 * `evaluateFeatureGate(id, 'shadow', ...).value` are the identical value by
 * construction, never `candidate`'s. `'shadow'` also records a
 * {@link FeatureGateShadowDecisionRecord}: `differs` compares the RAW
 * `legacy`/`candidate` summaries (so a real disagreement in a field the
 * allowlist later drops still gets flagged -- shadow mode exists to catch
 * behavioral drift, and under-reporting it because of what is safe to store
 * would defeat that), while `legacySummary`/`shadowSummary` themselves are
 * redacted through {@link redactDecisionSummary} (acceptance[1]).
 *
 * A pure function: no I/O, no shared mutable state, callable twice with a
 * different `state` argument for a direct side-by-side comparison.
 * @param gateId - the gate this evaluation is for.
 * @param state - the gate's resolved state; see {@link resolveFeatureGate}.
 * @param legacy - the existing, currently-shipped decision logic.
 * @param candidate - the new decision logic this gate is migrating to.
 * @param keepFields - allowlisted summary fields; see {@link redactDecisionSummary}.
 * @returns the applied value, plus a shadow diff record when `state` is `'shadow'`.
 */
export function evaluateFeatureGate<T>(
  gateId: FeatureGateId,
  state: FeatureGateState,
  legacy: () => FeatureGateDecisionOutcome<T>,
  candidate: () => FeatureGateDecisionOutcome<T>,
  keepFields: readonly string[],
): FeatureGateEvaluation<T> {
  switch (state) {
    case 'off':
      return { value: legacy().value }
    case 'enforce':
      return { value: candidate().value }
    case 'shadow': {
      const legacyOutcome = legacy()
      const candidateOutcome = candidate()
      return {
        value: legacyOutcome.value,
        shadowRecord: {
          gateId,
          legacySummary: redactDecisionSummary(legacyOutcome.summary, keepFields),
          shadowSummary: redactDecisionSummary(candidateOutcome.summary, keepFields),
          differs: !deepEqualJson(legacyOutcome.summary, candidateOutcome.summary),
        },
      }
    }
    default:
      return assertNever(state, `evaluateFeatureGate: unknown FeatureGateState ${JSON.stringify(state)}`)
  }
}

/**
 * One parsed `MAJOR.MINOR.PATCH(-PRERELEASE)?` harness version, matching the
 * root `package.json` `version` scheme (e.g. `0.1.2-alpha.4`).
 */
interface ParsedHarnessVersion {
  readonly release: readonly [number, number, number]
  readonly prerelease: readonly string[]
}

const HARNESS_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/**
 * Parse a harness version string into its release triple and dot-separated prerelease identifiers.
 * @param version - a `MAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH-PRERELEASE` string.
 * @returns the parsed release triple and prerelease identifiers (empty when there is no prerelease).
 * @throws {TypeError} when `version` does not match the harness version pattern.
 */
function parseHarnessVersion(version: string): ParsedHarnessVersion {
  const match = HARNESS_VERSION_PATTERN.exec(version)
  if (match === null) {
    throw new TypeError(`"${version}" is not a MAJOR.MINOR.PATCH[-PRERELEASE] harness version`)
  }
  const [, major, minor, patch, prerelease] = match
  return {
    release: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  }
}

/** Compare two dot-separated prerelease identifier lists per SemVer 2.0.0 §11's precedence rules. */
function comparePrereleaseIdentifiers(a: readonly string[], b: readonly string[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index]
    const right = b[index]
    // A shorter identifier list sorts lower once every preceding field is equal (SemVer §11.4.4).
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    const leftIsNumeric = /^\d+$/.test(left)
    const rightIsNumeric = /^\d+$/.test(right)
    if (leftIsNumeric && rightIsNumeric) return Number(left) - Number(right)
    // Numeric identifiers always have lower precedence than alphanumeric ones (SemVer §11.4.3).
    if (leftIsNumeric) return -1
    if (rightIsNumeric) return 1
    return left < right ? -1 : 1
  }
  return 0
}

/**
 * Compare two harness version strings by SemVer 2.0.0 precedence. Build
 * metadata is out of scope: this repository's versions never carry a `+`
 * segment. A version WITH a prerelease has strictly lower precedence than
 * the same release WITHOUT one (SemVer §11.3): `0.2.0-alpha.1 < 0.2.0`.
 * @param a - one harness version string.
 * @param b - the other harness version string.
 * @returns negative when `a` < `b`, positive when `a` > `b`, zero when equal.
 * @throws {TypeError} when either argument is not a well-formed harness version.
 */
function compareHarnessVersions(a: string, b: string): number {
  const left = parseHarnessVersion(a)
  const right = parseHarnessVersion(b)
  const [leftMajor, leftMinor, leftPatch] = left.release
  const [rightMajor, rightMinor, rightPatch] = right.release
  for (const diff of [leftMajor - rightMajor, leftMinor - rightMinor, leftPatch - rightPatch]) {
    if (diff !== 0) return diff
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  return comparePrereleaseIdentifiers(left.prerelease, right.prerelease)
}

/**
 * Release-gate expiry check (Epic P0-05 acceptance[2]): a gate is
 * `'expired'` once `releaseVersion` reaches or passes `gate.removalVersion`
 * under real SemVer precedence -- `0.10.0` correctly outranks `0.9.0`, and a
 * prerelease of the removal version (e.g. `0.2.0-alpha.1` against
 * `removalVersion: '0.2.0'`) is still `'active'`, never `'expired'` early.
 * @param gate - the gate declaration carrying `removalVersion`.
 * @param releaseVersion - the harness version under release-gate check.
 * @returns `'expired'` once `releaseVersion` >= `gate.removalVersion`, `'active'` otherwise.
 */
export const checkFeatureGateExpiry: FeatureGateExpiryCheck = (gate, releaseVersion) =>
  compareHarnessVersions(releaseVersion, gate.removalVersion) >= 0 ? 'expired' : 'active'
