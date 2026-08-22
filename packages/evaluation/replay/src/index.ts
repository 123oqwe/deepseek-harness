import { normalizeProjection, normalizePolicyDecisions, compareNormalized } from './normalizer.ts'
import { computeDiffs } from './diff.ts'
import { RecordedWorld } from './recorded-world.ts'
import type { ReplayBundle, ReplayResult, DecisionDiff } from './types.ts'

export type { ReplayBundle, ReplayResult, DecisionDiff } from './types.ts'
export { RecordedWorld } from './recorded-world.ts'
export { normalizeProjection, normalizePolicyDecisions, compareNormalized } from './normalizer.ts'
export { computeDiffs } from './diff.ts'

export function replay(
  bundle: ReplayBundle,
  replayFn: (bundle: ReplayBundle, world: RecordedWorld) => { events: unknown[]; policies: unknown[]; outcome: unknown },
  shadowMode = false,
): ReplayResult {
  const world = new RecordedWorld(bundle)
  const result = replayFn(bundle, world)

  const normalizedProjection = result.events
  const policyDecisions = result.policies
  const outcome = result.outcome

  const originalProjectionHash = normalizeProjection(bundle.events)
  const replayedProjectionHash = normalizeProjection(normalizedProjection)
  const projectionMatched = compareNormalized(originalProjectionHash, replayedProjectionHash)

  const originalPolicyHash = normalizePolicyDecisions(bundle.policyInputs)
  const replayedPolicyHash = normalizePolicyDecisions(policyDecisions)
  const policyMatched = compareNormalized(originalPolicyHash, replayedPolicyHash)

  const diffs: DecisionDiff[] = []
  if (!projectionMatched) {
    diffs.push(...computeDiffs(bundle.events, normalizedProjection))
  }
  if (!policyMatched && !shadowMode) {
    diffs.push(...computeDiffs(bundle.policyInputs, policyDecisions))
  }

  return {
    bundleId: bundle.bundleId,
    normalizedProjection,
    policyDecisions,
    outcome,
    diffs,
    allMatched: diffs.length === 0,
  }
}

export function checkNoExternalSideEffects(world: RecordedWorld): { passed: boolean; networkCalls: number; writeCalls: number } {
  return {
    passed: world.getNetworkCallCount() === 0 && world.getWriteCallCount() === 0,
    networkCalls: world.getNetworkCallCount(),
    writeCalls: world.getWriteCallCount(),
  }
}

export function checkSchemaCompat(
  bundleFp: string,
  expectedFp: string,
): { compatible: boolean; reason: string } {
  if (bundleFp === expectedFp) {
    return { compatible: true, reason: 'Schema fingerprints match' }
  }
  return {
    compatible: false,
    reason: `Schema mismatch: expected ${expectedFp}, got ${bundleFp}`,
  }
}
