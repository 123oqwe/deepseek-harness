/**
 * The one place a requested {@link WorldSpec} meets a {@link PolicySet} (P3-02 must[1]–[3]).
 *
 * Pure over values: no clock, no registry, no provider instance. A rule that
 * can only be reached through a running world is a rule no case can aim at
 * individually, and every refusal here has to be observable on its own.
 *
 * **Every refusal is collected, not the first.** A caller fixing a rejected
 * request needs the whole list; returning only the first would have them
 * discover the rest one round trip at a time, and an audit reading "denied:
 * network" would not learn that devices was also refused.
 * @module @deepseek-ai/dsh-execution-world/policy-solver
 */

import type {
  PolicyDecision,
  PolicyRefusal,
  PolicySet,
  SupportedPolicyFeatures,
} from './policy.ts'
import { WORLD_SPEC_DIMENSIONS, type WorldSpec, type WorldSpecDimension } from './types.ts'

/**
 * Whether a closed allowlist admits one value (must[1]).
 *
 * An EMPTY allowlist admits nothing. That is the whole meaning of closed: a
 * rule listing no permitted values permits none, rather than falling back to
 * "unconstrained" the way an absent rule might be misread. `[]` and absent are
 * therefore different answers, and this function only ever sees the first.
 * @param allowed - the closed set of permitted values.
 * @param requested - the value asked for.
 * @returns true when the value is listed.
 */
function admits<T>(allowed: readonly T[], requested: T): boolean {
  return allowed.includes(requested)
}

/**
 * Whether a requested ceiling is within the one a rule sets.
 *
 * An absent request asks for no ceiling at all, which is the WEAKER ask and is
 * admitted; an absent rule ceiling means the dimension may not be constrained,
 * so any request for one is refused by the caller before reaching here.
 * @param requested - the ceiling asked for, if any.
 * @param ceiling - the largest ceiling the rule permits.
 * @returns true when the request is within the rule.
 */
function withinCeiling(requested: number | undefined, ceiling: number | undefined): boolean {
  if (requested === undefined) return true
  if (ceiling === undefined) return false
  return requested <= ceiling
}

/**
 * Decide whether a requested world may be granted under a policy set.
 *
 * The three rules, in the order they are applied per dimension:
 *
 * 1. **Unknown is denied** (must[2]). A dimension with no rule refuses. Silence
 *    is not permission, and a policy set that grows a dimension later must not
 *    change the meaning of what it already said.
 * 2. **Allowlists are closed** (must[1]). A value not listed is refused, and an
 *    empty list refuses everything.
 * 3. **Weak may not pose as strong** (must[3]). A dimension the provider does
 *    not claim refuses even when the rule permits the value, because granting
 *    it would report a confinement nobody enforces — the failure mode this
 *    epic exists to remove.
 * @param spec - the requested world.
 * @param policy - the deployment's rules.
 * @param features - what the provider claims it can enforce.
 * @returns ok, or every reason the request was refused.
 */
export function satisfiesPolicySet(
  spec: WorldSpec,
  policy: PolicySet,
  features: SupportedPolicyFeatures,
): PolicyDecision {
  const refusals: PolicyRefusal[] = []
  const claimed = new Set<WorldSpecDimension>(WORLD_SPEC_DIMENSIONS)

  const governed = (dimension: WorldSpecDimension, rule: unknown): boolean => {
    if (rule === undefined) {
      refusals.push({ kind: 'unknown-dimension', dimension })
      return false
    }
    if (!claimed.has(dimension)) {
      refusals.push({ kind: 'unsupported-by-provider', dimension })
      return false
    }
    return true
  }

  if (governed('filesystem', policy.filesystem) && policy.filesystem !== undefined) {
    if (!admits(policy.filesystem.allowedEffects, spec.filesystem.effect)) {
      refusals.push({ kind: 'not-allowed', dimension: 'filesystem', requested: spec.filesystem.effect })
    }
  }
  if (governed('network', policy.network) && policy.network !== undefined) {
    if (!admits(policy.network.allowedPostures, spec.network.posture)) {
      refusals.push({ kind: 'not-allowed', dimension: 'network', requested: spec.network.posture })
    }
  }
  if (governed('process', policy.process) && policy.process !== undefined) {
    if (spec.process.spawn && !policy.process.allowSpawn) {
      refusals.push({ kind: 'not-allowed', dimension: 'process', requested: 'spawn' })
    }
    if (!withinCeiling(spec.process.maxProcesses, policy.process.maxProcessesCeiling)) {
      refusals.push({
        kind: 'exceeds-ceiling',
        dimension: 'process',
        requested: spec.process.maxProcesses ?? 0,
        ceiling: policy.process.maxProcessesCeiling ?? 0,
      })
    }
  }
  if (governed('ipc', policy.ipc) && policy.ipc !== undefined) {
    if (!admits(policy.ipc.allowedPostures, spec.ipc.posture)) {
      refusals.push({ kind: 'not-allowed', dimension: 'ipc', requested: spec.ipc.posture })
    }
  }
  if (governed('devices', policy.devices) && policy.devices !== undefined) {
    for (const device of spec.devices.allowed) {
      if (!admits(policy.devices.allowedDevices, device)) {
        refusals.push({ kind: 'not-allowed', dimension: 'devices', requested: device })
      }
    }
  }
  if (governed('secrets', policy.secrets) && policy.secrets !== undefined) {
    if (!admits(policy.secrets.allowedPostures, spec.secrets.posture)) {
      refusals.push({ kind: 'not-allowed', dimension: 'secrets', requested: spec.secrets.posture })
    }
  }
  if (governed('resources', policy.resources) && policy.resources !== undefined) {
    const rule = policy.resources
    const pairs: readonly [WorldSpecDimension, number | undefined, number | undefined][] = [
      ['resources', spec.resources.cpuMillicores, rule.cpuMillicoresCeiling],
      ['resources', spec.resources.memoryBytes, rule.memoryBytesCeiling],
      ['resources', spec.resources.diskBytes, rule.diskBytesCeiling],
    ]
    for (const [dimension, requested, ceiling] of pairs) {
      if (!withinCeiling(requested, ceiling)) {
        refusals.push({ kind: 'exceeds-ceiling', dimension, requested: requested ?? 0, ceiling: ceiling ?? 0 })
      }
    }
  }

  return refusals.length === 0 ? { ok: true } : { ok: false, refusals }
}

/**
 * The dimensions a policy set governs, in `WORLD_SPEC_DIMENSIONS` order.
 *
 * Derived from the record rather than declared beside it, so a dimension cannot
 * be governed in one place and missing from the list in another.
 * @param policy - the deployment's rules.
 * @returns every dimension carrying a rule.
 */
export function governedDimensions(policy: PolicySet): WorldSpecDimension[] {
  return WORLD_SPEC_DIMENSIONS.filter(
    dimension => (policy as Record<string, unknown>)[dimension] !== undefined,
  )
}
