/**
 * P3-02 C: the allow layer, and the three rules that make it closed.
 *
 * Every case supplies its own spec, policy and provider claim. Nothing here
 * starts a world, so a refusal is observable as itself rather than as a boot
 * that did not happen.
 *
 * acceptance[0] (no DNS/IPv4/IPv6/localhost/unix-socket/proxy when network is
 * off) and acceptance[1] (`/proc`, ps and debug attach restricted) are NOT
 * here. Both need a provider that can actually sever a network or hide a
 * process, and the only provider on this tree refuses any `network` posture but
 * `unrestricted` (`local-provider.ts:93`). Asserting them against a mock would
 * prove the mock refuses — BLOCKED-156's shape — and acceptance[1] is platform
 * dependent besides (`/proc` does not exist on macOS).
 */

import { describe, expect, it } from 'vitest'
import {
  LANDLOCK_FS_RIGHTS, transcribedLandlockName,
  type PolicySet, type SupportedPolicyFeatures,
} from '../src/policy.ts'
import { governedDimensions, satisfiesPolicySet } from '../src/policy-solver.ts'
import { WORLD_SPEC_DIMENSIONS, type WorldSpec } from '../src/types.ts'

/** A request that asks for the strongest confinement on every dimension. */
function spec(over: Partial<WorldSpec> = {}): WorldSpec {
  return {
    filesystem: { effect: 'read-only' },
    network: { posture: 'none' },
    process: { spawn: false },
    ipc: { posture: 'none' },
    devices: { allowed: [] },
    secrets: { posture: 'none' },
    resources: {},
    lifetime: { detached: false },
    tenant: 'tenant-1',
    ...over,
  } as unknown as WorldSpec
}

/** Rules permitting exactly what `spec()` asks for, and no more. */
function policy(over: Partial<PolicySet> = {}): PolicySet {
  return {
    filesystem: { allowedEffects: ['read-only'], allowedRights: [] },
    network: { allowedPostures: ['none'] },
    process: { allowSpawn: false, maxProcessesCeiling: 8 },
    ipc: { allowedPostures: ['none'] },
    devices: { allowedDevices: [] },
    secrets: { allowedPostures: ['none'] },
    resources: { cpuMillicoresCeiling: 1000, memoryBytesCeiling: 1 << 30, diskBytesCeiling: 1 << 30 },
    ...over,
  }
}

/** A provider claiming every dimension a policy set can govern. */
const CLAIMS_ALL: SupportedPolicyFeatures = {
  dimensions: ['filesystem', 'network', 'process', 'ipc', 'devices', 'secrets', 'resources'],
}

describe('P3-02 C must[1]: allowlists are closed', () => {
  it('grants a request every rule permits, so refusing everything is not a passing strategy', () => {
    // The reverse control. Without it, a solver that refused unconditionally
    // would satisfy every other case in this file — the over-broad mutant that
    // satisfied 10 of 16 security cases in P6-01.F.
    expect(satisfiesPolicySet(spec(), policy(), CLAIMS_ALL)).toStrictEqual({ ok: true })
  })

  it('refuses a posture the allowlist does not name, naming the dimension and the value asked for', () => {
    const decision = satisfiesPolicySet(spec({ network: { posture: 'unrestricted' } }), policy(), CLAIMS_ALL)

    expect(decision).toStrictEqual({
      ok: false,
      refusals: [{ kind: 'not-allowed', dimension: 'network', requested: 'unrestricted' }],
    })
  })

  it('treats an EMPTY allowlist as permitting nothing, not as unconstrained', () => {
    // `[]` and absent are different answers, and this is the one that says no.
    // A solver reading an empty list as "no restriction" would invert the rule
    // exactly where a deployment was most explicit.
    const decision = satisfiesPolicySet(spec(), policy({ network: { allowedPostures: [] } }), CLAIMS_ALL)

    expect(decision.ok).toBe(false)
  })

  it('collects every refusal rather than the first, so one round trip reports the whole gap', () => {
    const decision = satisfiesPolicySet(
      spec({ network: { posture: 'unrestricted' }, ipc: { posture: 'unrestricted' } }),
      policy(),
      CLAIMS_ALL,
    )

    if (decision.ok) throw new Error('unreachable: asserted a refusal')
    expect(decision.refusals.map(r => r.dimension)).toStrictEqual(['network', 'ipc'])
  })

  it('refuses a device the allowlist does not name, one refusal per device', () => {
    const decision = satisfiesPolicySet(spec({ devices: { allowed: ['/dev/kvm'] } }), policy(), CLAIMS_ALL)

    expect(decision).toStrictEqual({
      ok: false,
      refusals: [{ kind: 'not-allowed', dimension: 'devices', requested: '/dev/kvm' }],
    })
  })
})

describe('P3-02 C must[2]: an unknown capability is denied', () => {
  it('refuses a dimension no rule covers, so silence is not permission', () => {
    const { network: _omitted, ...withoutNetwork } = policy()

    const decision = satisfiesPolicySet(spec(), withoutNetwork, CLAIMS_ALL)

    expect(decision).toStrictEqual({
      ok: false,
      refusals: [{ kind: 'unknown-dimension', dimension: 'network' }],
    })
  })

  it('refuses the unknown dimension even when the request for it is the strongest one', () => {
    // `posture: 'none'` asks for no network at all — the safest possible
    // request. It is still refused, because the deployment has said nothing
    // about the dimension and an absent rule is not a permissive one.
    const { network: _omitted, ...withoutNetwork } = policy()

    expect(satisfiesPolicySet(spec({ network: { posture: 'none' } }), withoutNetwork, CLAIMS_ALL).ok).toBe(false)
  })

  it('reports the governed dimensions from the record itself, so the list cannot drift from the rules', () => {
    const { devices: _omitted, ...withoutDevices } = policy()

    expect(governedDimensions(withoutDevices)).toStrictEqual(
      WORLD_SPEC_DIMENSIONS.filter(d => d !== 'devices' && d !== 'lifetime' && d !== 'tenant'),
    )
  })
})

describe('P3-02 C must[3]: a provider may not claim a dimension it cannot enforce', () => {
  it('refuses a dimension the provider does not claim, even when the policy permits the value', () => {
    // This is the impersonation the clause forbids. The rule says `none` is
    // allowed and the request asks for `none`; granting it would report a
    // severed network that nothing severs.
    const decision = satisfiesPolicySet(spec(), policy(), { dimensions: ['filesystem'] })

    if (decision.ok) throw new Error('unreachable: asserted a refusal')
    expect(decision.refusals).toContainEqual({ kind: 'unsupported-by-provider', dimension: 'network' })
  })

  it('grants the same request once the provider claims the dimensions, so the refusal is caused by the claim', () => {
    // The control that scopes the case above: the only thing changed is the
    // provider's declaration.
    expect(satisfiesPolicySet(spec(), policy(), CLAIMS_ALL)).toStrictEqual({ ok: true })
  })

  it('refuses a ceiling larger than the rule permits, and reports both numbers', () => {
    const decision = satisfiesPolicySet(spec({ resources: { cpuMillicores: 4000 } }), policy(), CLAIMS_ALL)

    expect(decision).toStrictEqual({
      ok: false,
      refusals: [{ kind: 'exceeds-ceiling', dimension: 'resources', requested: 4000, ceiling: 1000 }],
    })
  })

  it('refuses ANY ceiling when the rule sets none, since an unconstrainable dimension cannot be constrained', () => {
    const decision = satisfiesPolicySet(
      spec({ resources: { memoryBytes: 1024 } }),
      policy({ resources: { cpuMillicoresCeiling: 1000 } }),
      CLAIMS_ALL,
    )

    expect(decision.ok).toBe(false)
  })
})

describe('P3-02 C: the Landlock filesystem-rights vocabulary', () => {
  it('names the Landlock filesystem rights by their kernel UAPI names, all sixteen in ABI order', () => {
    // The UAPI spelling is the stable ABI and the one a kernel manual uses.
    expect(LANDLOCK_FS_RIGHTS).toHaveLength(16)
    expect(LANDLOCK_FS_RIGHTS[0]).toBe('LANDLOCK_ACCESS_FS_EXECUTE')
    expect(LANDLOCK_FS_RIGHTS[13]).toBe('LANDLOCK_ACCESS_FS_REFER')
    expect(LANDLOCK_FS_RIGHTS[15]).toBe('LANDLOCK_ACCESS_FS_IOCTL_DEV')
  })

  it('records the abbreviation this repository transcribed them under, so either spelling is findable', () => {
    // `native/landlock-run/packages/entry/src/main.c:71-86` writes the same
    // bits as `LL_FS_*`. Pinning only the UAPI name would leave a reader
    // grepping this tree for it, finding nothing, and concluding no
    // transcription exists — the shape that made BLOCKED-178 read as unstarted
    // work for months.
    expect(transcribedLandlockName('LANDLOCK_ACCESS_FS_EXECUTE')).toBe('LL_FS_EXECUTE')
    expect(transcribedLandlockName('LANDLOCK_ACCESS_FS_IOCTL_DEV')).toBe('LL_FS_IOCTL_DEV')
  })
})

describe('P3-02 C acceptance[2]: serialization keeps every field', () => {
  it('round-trips a policy set through JSON with nothing dropped, including an empty allowlist', () => {
    // The empty list is the field most likely to be lost by a serializer that
    // prunes falsy values — and it is the one carrying the strongest rule.
    const before = policy({ network: { allowedPostures: [] } })

    expect(JSON.parse(JSON.stringify(before))).toStrictEqual(before)
  })

  it('round-trips a refusal list, so an audit reads the same reasons the solver gave', () => {
    const decision = satisfiesPolicySet(spec({ network: { posture: 'unrestricted' } }), policy(), CLAIMS_ALL)

    expect(JSON.parse(JSON.stringify(decision))).toStrictEqual(decision)
  })
})
