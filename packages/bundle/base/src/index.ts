/**
 * @deepseek-ai/dsh-base — the shared dsh core as a profile bundle. The
 * package's substance is `cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field and resolved by the profile composer through that field;
 * this module carries no runtime API.
 * @module @deepseek-ai/dsh-base
 */

export {}

// P0-05: Re-export feature gate types for profile composition
export type { FeatureGate, GateState } from '@deepseek-ai/dsh-feature-gates'
export { resolveGate, setOverride, registerGate } from '@deepseek-ai/dsh-feature-gates'
