/**
 * Contract-stage type surface for Epic P0-05 (Shadow/Enforce feature gates):
 * the unified `off|shadow|enforce` state (must[0]), the fixed lifecycle
 * metadata every gate records (must[2]), the settings-namespace value shape
 * a `feature-gates` registration (`packages/settings/settings/src/index.ts`'s
 * `SettingsProvider.register`) would carry (must[3]'s `'settings'` override
 * source, JSON-safe per `packages/settings/settings/src/types.ts`'s
 * `SettingsNamespaceView.value: JsonValue`), the `--dump-config` override
 * chain shape (must[3]), the shadow/legacy decision-diff record shape
 * (acceptance[1]), and the release-gate expiry check signature
 * (acceptance[2]).
 *
 * No runtime code: no `Config` schema and no `apply(ctx, config)` plugin
 * export, matching `@deepseek-ai/dsh-trust-kernel/types`'s own Contract-stage
 * convention -- gate registration, evaluation, and CLI/profile wiring are
 * later (Provider/Usage-stage) slices' deliverables; see `src/index.ts`'s
 * own doc comment.
 *
 * @module @deepseek-ai/dsh-feature-gates/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Nominal id of one declared feature gate, one per gated major capability. */
export type FeatureGateId = Branded<'FeatureGateId'>

/**
 * The unified feature-gate state (Epic P0-05 must[0]): exactly these three
 * values, never a fourth. `'shadow'` runs the SAME decision logic as
 * `'enforce'` but the caller applies only the legacy outcome to the actual
 * result -- must[1]'s "executes its decision logic but does NOT change the
 * actual outcome" -- and instead records a
 * {@link FeatureGateShadowDecisionRecord} comparing the two.
 */
export type FeatureGateState = 'off' | 'shadow' | 'enforce'

/**
 * One gate's state per deployment profile (`dsh --profile <name>`, see
 * `apps/cli/src/dump-config.ts`'s own `profile: string` parameter).
 * `default` is the repo-wide fallback every declaration must supply; a
 * profile absent from this index falls back to it.
 */
export interface FeatureGateProfileDefaults {
  /** Fallback state for a profile without its own explicit entry below. */
  readonly default: FeatureGateState
  /** Per-profile overrides, keyed by profile name. */
  readonly [profile: string]: FeatureGateState
}

/**
 * The fixed metadata every feature gate records (Epic P0-05 must[2]): who
 * owns it, which harness version introduced it, its state per deployment
 * profile, and the version past which a release-gate check must fail it
 * (see {@link FeatureGateExpiryCheck}).
 */
export interface FeatureGateDeclaration {
  /** The gate this declaration describes. */
  readonly id: FeatureGateId
  /** Team or individual responsible for the gated capability. */
  readonly owner: string
  /** Harness version (matches the root `package.json` `version`) that first shipped this gate. */
  readonly introducedVersion: string
  /** This gate's state per deployment profile; see {@link FeatureGateProfileDefaults}. */
  readonly defaultByProfile: FeatureGateProfileDefaults
  /** Harness version past which this gate must be retired; see {@link FeatureGateExpiryCheck}. */
  readonly removalVersion: string
}

/**
 * One `feature-gates` settings namespace value (Epic P0-05 must[3]'s
 * `'settings'` override source): the JSON-safe map a registered
 * `feature-gates` namespace's `SettingsNamespaceView.value`
 * (`packages/settings/settings/src/types.ts`) would carry, gate id to its
 * currently stored override. Every field is a {@link FeatureGateState}
 * literal, so the map is JSON-safe by construction and needs no redaction
 * pass through `SettingsProvider.describe({ redactSecrets: true })` before
 * reaching a Remote wire view.
 */
export interface FeatureGateNamespaceValue {
  readonly [gateId: string]: FeatureGateState
}

/**
 * Where one gate's resolved state came from, in override-precedence order
 * (lowest first), extending must[3]'s own example (`default → profile
 * override → env override`) with the settings layer this contract
 * interoperates with: `'default'` is the declaration's own
 * {@link FeatureGateProfileDefaults}, `'profile'` is a profile-specific
 * override layered the same way `SettingsRegisterOptions.base` layers below
 * the user section, `'settings'` is a stored
 * {@link FeatureGateNamespaceValue} override, and `'env'` is the
 * highest-precedence CLI/environment override.
 */
export type FeatureGateOverrideSource = 'default' | 'profile' | 'settings' | 'env'

/** One candidate source and the state it would contribute to a gate's resolution. */
export interface FeatureGateOverrideEntry {
  /** Which layer this candidate came from. */
  readonly source: FeatureGateOverrideSource
  /** The state that layer would contribute. */
  readonly value: FeatureGateState
}

/**
 * The final resolved value `--dump-config` must show for one gate (Epic
 * P0-05 must[3]): its winning source/value plus the complete override chain
 * that produced it, lowest-precedence entry first.
 */
export interface FeatureGateResolution {
  /** The gate this resolution describes. */
  readonly gateId: FeatureGateId
  /** The winning source and the state it contributed. */
  readonly resolved: FeatureGateOverrideEntry
  /** Every candidate that fed the resolution, lowest-precedence first. */
  readonly chain: readonly FeatureGateOverrideEntry[]
}

/**
 * The complete, sanitized difference between one gate's shadow decision and
 * the legacy decision it ran alongside (Epic P0-05 acceptance[1]).
 * `legacySummary` and `shadowSummary` are `JsonValue`, not `unknown`: unlike
 * `TrustKernelPolicyQuery`'s deliberately opaque `unknown` payload
 * (`@deepseek-ai/dsh-trust-kernel/types`), a shadow record is written to a
 * comparable event a later analysis reads, so a caller must construct an
 * already-redacted, JSON-safe summary before this type will accept it --
 * there is no raw-parameter field to leak sensitive data through by
 * accident.
 */
export interface FeatureGateShadowDecisionRecord {
  /** The gate this record compares. */
  readonly gateId: FeatureGateId
  /** Pre-redacted summary of the legacy (actually-applied) decision. */
  readonly legacySummary: JsonValue
  /** Pre-redacted summary of the shadow (evaluated-only) decision. */
  readonly shadowSummary: JsonValue
  /** Whether the two summaries disagree. */
  readonly differs: boolean
}

/** Whether one gate is still within its declared lifetime, or has aged past `removalVersion`. */
export type FeatureGateExpiryStatus = 'active' | 'expired'

/**
 * Release-gate expiry check signature (Epic P0-05 acceptance[2]): compares
 * one gate's `removalVersion` against the harness version under release.
 * Side-effect-free, matching `TrustKernelPolicyEnforcement`'s own narrow,
 * pure entrypoint shape (`@deepseek-ai/dsh-trust-kernel/types`).
 */
export type FeatureGateExpiryCheck = (gate: FeatureGateDeclaration, releaseVersion: string) => FeatureGateExpiryStatus
