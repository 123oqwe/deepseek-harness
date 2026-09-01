/**
 * RED-stage stub: real signatures, placeholder bodies. Replaced by the real
 * Provider-stage implementation in the GREEN commit.
 * @module @deepseek-ai/dsh-feature-gates
 */
export type * from './types.ts'

import type {
  FeatureGateDeclaration,
  FeatureGateExpiryCheck,
  FeatureGateId,
  FeatureGateNamespaceValue,
  FeatureGateResolution,
  FeatureGateShadowDecisionRecord,
  FeatureGateState,
  RedactedJsonValue,
} from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** RED stub. */
export function resolveFeatureGate(
  declaration: FeatureGateDeclaration,
  _profile: string,
  _overrides: { readonly settings?: FeatureGateNamespaceValue; readonly env?: FeatureGateState } = {},
): FeatureGateResolution {
  return { gateId: declaration.id, resolved: { source: 'default', value: 'off' }, chain: [] }
}

/** RED stub. */
export function redactDecisionSummary(
  _summary: Readonly<Record<string, JsonValue>>,
  _keepFields: readonly string[],
): RedactedJsonValue {
  return {} as RedactedJsonValue
}

/** RED stub. */
export interface FeatureGateDecisionOutcome<T> {
  readonly value: T
  readonly summary: Readonly<Record<string, JsonValue>>
}

/** RED stub. */
export interface FeatureGateEvaluation<T> {
  readonly value: T
  readonly shadowRecord?: FeatureGateShadowDecisionRecord
}

/** RED stub: always applies candidate, never redacts, never records -- must fail every meaningful assertion. */
export function evaluateFeatureGate<T>(
  _gateId: FeatureGateId,
  _state: FeatureGateState,
  _legacy: () => FeatureGateDecisionOutcome<T>,
  candidate: () => FeatureGateDecisionOutcome<T>,
  _keepFields: readonly string[],
): FeatureGateEvaluation<T> {
  return { value: candidate().value }
}

/** RED stub: always active. */
export const checkFeatureGateExpiry: FeatureGateExpiryCheck = () => 'active'
