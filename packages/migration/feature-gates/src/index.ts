/**
 * Shadow/Enforce Feature Gates for safe capability rollout.
 *
 * Allows major capabilities (trust kernel, run, policy, verification) to be
 * rolled out in three stages: off -> shadow -> enforce. Shadow mode executes
 * the new decision path but does not change the user-visible result; it only
 * records comparison events. Enforce mode uses the new path for real.
 *
 * @module @deepseek-ai/dsh-feature-gates
 */

import type { FeatureGate, GateState, ResolvedGate, ShadowEvent } from './types.ts'
import { ExpiredGateError, GateDowngradeError } from './types.ts'

export type { FeatureGate, GateState, ResolvedGate, ShadowEvent } from './types.ts'
export { ExpiredGateError, GateDowngradeError } from './types.ts'

/** Registry of all known feature gates. */
const gateRegistry = new Map<string, FeatureGate>()

/** Override store: gateId -> (profile -> state). */
const overrides = new Map<string, Map<string, GateState>>()

/** Shadow event log. */
const shadowEvents: ShadowEvent[] = []

/** Current harness version for expiry checking. */
let currentVersion = '0.1.0-rc.5'

/** Whether the current principal has kernel admin permission. */
let hasKernelAdmin = false

/** Set the current harness version (for expiry testing). */
export function setCurrentVersion(v: string): void { currentVersion = v }

/** Grant kernel admin permission (called by Trust Kernel). */
export function grantKernelAdmin(): void { hasKernelAdmin = true }

/** Revoke kernel admin permission. */
export function revokeKernelAdmin(): void { hasKernelAdmin = false }

/** Compare semantic versions: -1, 0, or 1. Handles pre-release suffixes. */
function compareSemver(a: string, b: string): number {
  const [aMain, aPre] = a.split('-')
  const [bMain, bPre] = b.split('-')
  const pa = aMain.split('.').map(Number)
  const pb = bMain.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va !== vb) return va - vb
  }
  if (aPre && !bPre) return -1
  if (!aPre && bPre) return 1
  if (aPre && bPre) return aPre.localeCompare(bPre)
  return 0
}

/** Register a feature gate. */
export function registerGate(gate: FeatureGate): void {
  if (gateRegistry.has(gate.id)) {
    throw new Error(`Feature gate '${gate.id}' already registered`)
  }
  gateRegistry.set(gate.id, gate)
}

/** Check if a gate has expired. */
export function isExpired(gateId: string): boolean {
  const gate = gateRegistry.get(gateId)
  if (!gate) return false
  return compareSemver(gate.removalVersion, currentVersion) <= 0
}

/** Assert no expired gates exist. */
export function assertNoExpiredGates(): void {
  for (const [id, gate] of gateRegistry) {
    if (compareSemver(gate.removalVersion, currentVersion) <= 0) {
      throw new ExpiredGateError(id, gate.removalVersion, currentVersion)
    }
  }
}

/**
 * Resolve a gate's state for a given profile, considering overrides.
 * Override chain: bundle default -> profile default -> home override -> CLI override.
 */
export function resolveGate(gateId: string, profile: string): ResolvedGate {
  const gate = gateRegistry.get(gateId)
  if (!gate) throw new Error(`Unknown feature gate: ${gateId}`)

  const chain: string[] = []

  const bundleDefault = gate.defaultByProfile['__default__'] ?? 'off'
  chain.push(`bundle:${bundleDefault}`)

  const profileDefault = gate.defaultByProfile[profile] ?? bundleDefault
  chain.push(`profile:${profileDefault}`)

  const homeOverride = overrides.get(gateId)?.get('__home__')
  if (homeOverride !== undefined) {
    chain.push(`home:${homeOverride}`)
  }

  const cliOverride = overrides.get(gateId)?.get('__cli__')
  if (cliOverride !== undefined) {
    chain.push(`cli:${cliOverride}`)
  }

  const finalState = cliOverride ?? homeOverride ?? profileDefault
  const source = cliOverride !== undefined ? 'cli'
    : homeOverride !== undefined ? 'home'
    : 'profile'

  return { id: gateId, state: finalState, source, overrideChain: chain }
}

/**
 * Set an override for a gate. Enforce -> off/shadow downgrade requires kernel admin.
 */
export function setOverride(gateId: string, scope: '__home__' | '__cli__', state: GateState): void {
  const gate = gateRegistry.get(gateId)
  if (!gate) throw new Error(`Unknown feature gate: ${gateId}`)

  const current = resolveGate(gateId, 'web')
  if (current.state === 'enforce' && state === 'off' && !hasKernelAdmin) {
    throw new GateDowngradeError(gateId, state)
  }
  if (current.state === 'enforce' && state === 'shadow' && !hasKernelAdmin) {
    throw new GateDowngradeError(gateId, state)
  }

  if (!overrides.has(gateId)) overrides.set(gateId, new Map())
  overrides.get(gateId)!.set(scope, state)
}

/**
 * Record a shadow comparison event.
 * Sensitive parameters are redacted in the stored payload.
 */
export function recordShadowEvent(
  gateId: string,
  legacyResult: unknown,
  shadowResult: unknown,
  sensitiveParams?: string[],
): ShadowEvent {
  const redact = (s: string) => {
    let redacted = s
    for (const param of sensitiveParams ?? []) {
      redacted = redacted.replaceAll(param, '[REDACTED]')
    }
    return redacted
  }

  const event: ShadowEvent = {
    gateId,
    timestamp: new Date().toISOString(),
    legacyResult,
    shadowResult,
    equal: JSON.stringify(legacyResult) === JSON.stringify(shadowResult),
    redactedPayload: redact(JSON.stringify({ legacyResult, shadowResult })),
  }
  shadowEvents.push(event)
  return event
}

/** Get all recorded shadow events for a gate. */
export function getShadowEvents(gateId: string): ShadowEvent[] {
  return shadowEvents.filter(e => e.gateId === gateId)
}

/** Clear all gates, overrides, and shadow events. For testing. */
export function clearAll(): void {
  gateRegistry.clear()
  overrides.clear()
  shadowEvents.length = 0
  hasKernelAdmin = false
  currentVersion = '0.1.0-rc.5'
}

/** Register the built-in feature gates for the Harness. */
export function registerBuiltinGates(): void {
  registerGate({
    id: 'trust-kernel',
    description: 'Minimal Immutable Trust Kernel enforcement',
    owner: 'kernel-team',
    introducedVersion: '0.1.0-rc.5',
    removalVersion: '1.0.0',
    defaultByProfile: { __default__: 'shadow', web: 'shadow', headless: 'shadow' },
  })

  registerGate({
    id: 'policy-enforcement',
    description: 'Policy Decision Service with monotonic deny',
    owner: 'security-team',
    introducedVersion: '0.1.0-rc.5',
    removalVersion: '1.0.0',
    defaultByProfile: { __default__: 'off', web: 'shadow', headless: 'off' },
  })

  registerGate({
    id: 'run-journal',
    description: 'Durable Run Service with workflow journal',
    owner: 'workflow-team',
    introducedVersion: '0.1.0-rc.5',
    removalVersion: '1.0.0',
    defaultByProfile: { __default__: 'off', web: 'off', headless: 'shadow' },
  })
}
