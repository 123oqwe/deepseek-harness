/**
 * Contract stage for Epic P1-09's Service/Tool/Event namespace
 * and ownership conflict detection. One `it()` per registry-declared
 * acceptance clause (splitting acceptance[0]'s three named fail-closed
 * scenarios into three cases) plus every must[] clause that is structurally
 * testable at this Contract level. Every case calls a real exported function
 * against real branded fixture data.
 *
 * The final `describe` block is this epic's Fault stage over the same
 * functions: conditions the adjudication core had never been given — an
 * override contract aimed at a reserved namespace, a token forged to carry
 * the real owner's mint prefix, a token replayed after its registration is
 * gone, and one plugin's token presented against its own second capability.
 * The Contract cases above are unchanged.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  buildInventoryChain,
  claimCapability,
  mintOwnershipToken,
  requestReplace,
  revokeByOwnershipToken,
  RESERVED_NAMESPACE_ROOT,
} from '../src/index.ts'
import type {
  CapabilityRegistration,
  Namespace,
  OwnershipToken,
  PluginIdentity,
  RegistryPolicy,
  StableCapabilityId,
} from '../src/types.ts'

const officialPlugin = brandString<PluginIdentity>('dsh-base')
const attackerPlugin = brandString<PluginIdentity>('evil-plugin')
const friendlyPluginA = brandString<PluginIdentity>('friendly-tools-a')
const friendlyPluginB = brandString<PluginIdentity>('friendly-tools-b')
const friendlyPluginC = brandString<PluginIdentity>('friendly-tools-c')

const reservedNamespace: Namespace = RESERVED_NAMESPACE_ROOT
const friendlyNamespace = brandString<Namespace>('friendly-tools')

const policy: RegistryPolicy = {
  officialPluginIdentities: new Set([officialPlugin]),
  allowReplace: true,
}
const policyDenyingReplace: RegistryPolicy = {
  officialPluginIdentities: new Set([officialPlugin]),
  allowReplace: false,
}

/** Build a fixture {@link CapabilityRegistration} without exercising the (stubbed) real mint function. */
function fixtureRegistration(
  pluginIdentity: PluginIdentity,
  capabilityId: StableCapabilityId,
  ownershipToken: OwnershipToken,
  overrides: Partial<Pick<CapabilityRegistration, 'namespace' | 'kind' | 'origin'>> = {},
): CapabilityRegistration {
  return {
    pluginIdentity,
    namespace: overrides.namespace ?? friendlyNamespace,
    capabilityId,
    kind: overrides.kind ?? 'tool',
    origin: overrides.origin ?? 'static',
    ownershipToken,
  }
}

describe('P1-09 Contract — must clauses', () => {
  it('must[0]: a successful capability claim carries PluginIdentity, namespace, stable capability id, and a minted ownership token', () => {
    const capabilityId = brandString<StableCapabilityId>('friendly-tools:read_file')
    const decision = claimCapability(
      { pluginIdentity: friendlyPluginA, namespace: friendlyNamespace, capabilityId, kind: 'tool', origin: 'static' },
      [],
      policy,
    )
    expect(decision.admitted).toBe(true)
    if (decision.admitted) {
      expect(decision.registration.pluginIdentity).toBe(friendlyPluginA)
      expect(decision.registration.namespace).toBe(friendlyNamespace)
      expect(decision.registration.capabilityId).toBe(capabilityId)
      expect(typeof decision.registration.ownershipToken).toBe('string')
      expect(decision.registration.ownershipToken.length).toBeGreaterThan(0)
    }
  })

  it('must[1]: an unofficial plugin cannot claim a capability inside the dsh.* reserved namespace', () => {
    const capabilityId = brandString<StableCapabilityId>('dsh.core:read_file')
    const decision = claimCapability(
      { pluginIdentity: attackerPlugin, namespace: reservedNamespace, capabilityId, kind: 'service', origin: 'static' },
      [],
      policy,
    )
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('namespace-reserved')
  })

  it('must[1]: an unofficial plugin cannot claim a capability inside a dotted sub-namespace under the dsh.* reserved root', () => {
    const dottedReservedNamespace = brandString<Namespace>('dsh.core')
    const capabilityId = brandString<StableCapabilityId>('dsh.core:write_file')
    const decision = claimCapability(
      { pluginIdentity: attackerPlugin, namespace: dottedReservedNamespace, capabilityId, kind: 'service', origin: 'static' },
      [],
      policy,
    )
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('namespace-reserved')
  })

  it('must[2]: an explicit replace contract fails closed when policy does not authorize replacement', () => {
    const capabilityId = brandString<StableCapabilityId>('friendly-tools:write_file')
    const existing = [fixtureRegistration(friendlyPluginA, capabilityId, brandString<OwnershipToken>('token-a'))]
    const decision = requestReplace(
      { targetCapabilityId: capabilityId, replacingPluginIdentity: friendlyPluginB },
      existing,
      policyDenyingReplace,
    )
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('replace-not-authorized')
  })

  it('must[2]: an explicit replace contract fails closed with replace-not-authorized when the target capability id has no existing registration to replace', () => {
    const unrelatedId = brandString<StableCapabilityId>('friendly-tools:unrelated')
    const targetId = brandString<StableCapabilityId>('friendly-tools:never_claimed')
    const existing = [fixtureRegistration(friendlyPluginA, unrelatedId, brandString<OwnershipToken>('token-unrelated'))]
    const decision = requestReplace(
      { targetCapabilityId: targetId, replacingPluginIdentity: friendlyPluginB },
      existing,
      policy,
    )
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('replace-not-authorized')
  })

  it('must[3]: revoking with a valid ownership token removes only that token\'s own effects', () => {
    const capabilityIdA = brandString<StableCapabilityId>('friendly-tools:tool-a')
    const capabilityIdB = brandString<StableCapabilityId>('friendly-tools:tool-b')
    const tokenA = brandString<OwnershipToken>('token-a')
    const tokenB = brandString<OwnershipToken>('token-b')
    const existing = [
      fixtureRegistration(friendlyPluginA, capabilityIdA, tokenA),
      fixtureRegistration(friendlyPluginB, capabilityIdB, tokenB),
    ]
    const result = revokeByOwnershipToken(tokenA, existing)
    expect(result.revoked).toBe(true)
    if (result.revoked) {
      expect(result.revokedCapabilityIds).toEqual([capabilityIdA])
      expect(result.revokedCapabilityIds).not.toContain(capabilityIdB)
    }
  })
})

describe('P1-09 Contract — acceptance[0]: 同名工具、跨插件撤销、加载顺序攻击均 fail closed', () => {
  it('same-name tool collision: a second plugin registering an already-claimed capability id without a replace contract fails closed', () => {
    const capabilityId = brandString<StableCapabilityId>('friendly-tools:shared_tool')
    const existing = [fixtureRegistration(friendlyPluginA, capabilityId, brandString<OwnershipToken>('token-a'), { kind: 'tool' })]
    const decision = claimCapability(
      { pluginIdentity: friendlyPluginB, namespace: friendlyNamespace, capabilityId, kind: 'tool', origin: 'static' },
      existing,
      policy,
    )
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('capability-collision')
  })

  it('cross-plugin revocation: a token that matches no active registration revokes nothing, and the real owner\'s token still works afterward', () => {
    const capabilityId = brandString<StableCapabilityId>('friendly-tools:owned_tool')
    const realToken = brandString<OwnershipToken>('real-token')
    const forgedToken = brandString<OwnershipToken>('forged-token')
    const existing = [fixtureRegistration(friendlyPluginA, capabilityId, realToken)]

    const forgedAttempt = revokeByOwnershipToken(forgedToken, existing)
    expect(forgedAttempt.revoked).toBe(false)
    if (!forgedAttempt.revoked) expect(forgedAttempt.reason).toBe('unknown-token')

    const legitimateAttempt = revokeByOwnershipToken(realToken, existing)
    expect(legitimateAttempt.revoked).toBe(true)
    if (legitimateAttempt.revoked) expect(legitimateAttempt.revokedCapabilityIds).toEqual([capabilityId])
  })

  it('load-order attack: a third party claiming a reserved-namespace capability before the official plugin ever registers still fails closed, and the official plugin can still claim it afterward', () => {
    const capabilityId = brandString<StableCapabilityId>('dsh.core:boot_hook')

    const attackerAttempt = claimCapability(
      { pluginIdentity: attackerPlugin, namespace: reservedNamespace, capabilityId, kind: 'service', origin: 'static' },
      [],
      policy,
    )
    expect(attackerAttempt.admitted).toBe(false)
    if (!attackerAttempt.admitted) expect(attackerAttempt.reason).toBe('namespace-reserved')

    // The attacker's rejected attempt admitted nothing, so the official
    // plugin still sees an empty registry for this capability id.
    const officialAttempt = claimCapability(
      { pluginIdentity: officialPlugin, namespace: reservedNamespace, capabilityId, kind: 'service', origin: 'static' },
      [],
      policy,
    )
    expect(officialAttempt.admitted).toBe(true)
    if (officialAttempt.admitted) expect(officialAttempt.registration.pluginIdentity).toBe(officialPlugin)
  })
})

describe('P1-09 Contract — acceptance[1]: 允许合法 provider replacement，但 Inventory 显示 replaced/replacing chain', () => {
  it('an authorized replace contract succeeds, and buildInventoryChain shows the replaced/replacing chain', () => {
    const capabilityId = brandString<StableCapabilityId>('friendly-tools:provider')
    const priorToken = brandString<OwnershipToken>('token-prior')
    const priorRegistration = fixtureRegistration(friendlyPluginA, capabilityId, priorToken)

    const decision = requestReplace(
      { targetCapabilityId: capabilityId, replacingPluginIdentity: friendlyPluginB },
      [priorRegistration],
      policy,
    )
    expect(decision.admitted).toBe(true)
    if (decision.admitted) {
      expect(decision.registration.pluginIdentity).toBe(friendlyPluginB)
      expect(decision.registration.capabilityId).toBe(capabilityId)

      const chain = buildInventoryChain([priorRegistration, decision.registration])
      const entry = chain.find(candidate => candidate.capabilityId === capabilityId)
      expect(entry).toBeDefined()
      expect(entry?.current).toBe(friendlyPluginB)
      expect(entry?.replaces).toBe(friendlyPluginA)
    }
  })

  it('buildInventoryChain on a 3-owner history reports the current owner and its immediate predecessor, not the chain\'s original first owner', () => {
    const capabilityId = brandString<StableCapabilityId>('friendly-tools:long_lived_provider')
    const originalOwner = fixtureRegistration(friendlyPluginA, capabilityId, brandString<OwnershipToken>('token-1'))
    const secondOwner = fixtureRegistration(friendlyPluginB, capabilityId, brandString<OwnershipToken>('token-2'))
    const thirdOwner = fixtureRegistration(friendlyPluginC, capabilityId, brandString<OwnershipToken>('token-3'))

    const chain = buildInventoryChain([originalOwner, secondOwner, thirdOwner])
    const entries = chain.filter(candidate => candidate.capabilityId === capabilityId)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry).toBeDefined()
    expect(entry?.current).toBe(friendlyPluginC)
    expect(entry?.replaces).toBe(friendlyPluginB)
    expect(entry?.replaces).not.toBe(friendlyPluginA)
    expect(entry?.replacedBy).toBeUndefined()
  })
})

describe('P1-09 Contract — acceptance[2]: 动态 Cordis 定义同样受规则约束', () => {
  it('a dynamically defined capability is subject to the same reserved-namespace and collision rules as a statically declared one', () => {
    const reservedDynamicId = brandString<StableCapabilityId>('dsh.core:dynamic_hook')
    const reservedAttempt = claimCapability(
      { pluginIdentity: attackerPlugin, namespace: reservedNamespace, capabilityId: reservedDynamicId, kind: 'event', origin: 'dynamic' },
      [],
      policy,
    )
    expect(reservedAttempt.admitted).toBe(false)
    if (!reservedAttempt.admitted) expect(reservedAttempt.reason).toBe('namespace-reserved')

    const sharedId = brandString<StableCapabilityId>('friendly-tools:shared_dynamic_tool')
    const staticOwner = fixtureRegistration(friendlyPluginA, sharedId, brandString<OwnershipToken>('token-static'), { origin: 'static' })
    const dynamicCollisionAttempt = claimCapability(
      { pluginIdentity: friendlyPluginB, namespace: friendlyNamespace, capabilityId: sharedId, kind: 'tool', origin: 'dynamic' },
      [staticOwner],
      policy,
    )
    expect(dynamicCollisionAttempt.admitted).toBe(false)
    if (!dynamicCollisionAttempt.admitted) expect(dynamicCollisionAttempt.reason).toBe('capability-collision')
  })

  it('a dynamically defined capability for a fresh, non-reserved, non-colliding namespace is admitted exactly as a statically declared one would be', () => {
    const dynamicNamespace = brandString<Namespace>('friendly-dynamic-tools')
    const capabilityId = brandString<StableCapabilityId>('friendly-dynamic-tools:new_dynamic_tool')
    const decision = claimCapability(
      { pluginIdentity: friendlyPluginA, namespace: dynamicNamespace, capabilityId, kind: 'tool', origin: 'dynamic' },
      [],
      policy,
    )
    expect(decision.admitted).toBe(true)
    if (decision.admitted) {
      expect(decision.registration.pluginIdentity).toBe(friendlyPluginA)
      expect(decision.registration.namespace).toBe(dynamicNamespace)
      expect(decision.registration.capabilityId).toBe(capabilityId)
      expect(decision.registration.origin).toBe('dynamic')
      expect(typeof decision.registration.ownershipToken).toBe('string')
      expect(decision.registration.ownershipToken.length).toBeGreaterThan(0)
    }
  })
})

describe('P1-09 Fault — adversarial conditions the adjudication core has not seen', () => {
  it('must[1]/must[2]: an unofficial plugin cannot take a reserved dsh.* capability through a replace contract, even when policy allows replacement', () => {
    // must[1] is stated unconditionally, and must[2] requires an override to
    // carry an explicit contract AND pass policy. Neither says `allowReplace`
    // suspends must[1], so the replace path owes the same reserved-namespace
    // refusal the claim path already enforces.
    const capabilityId = brandString<StableCapabilityId>('dsh.core.read_file')
    const reservedSubNamespace = brandString<Namespace>('dsh.core')
    const officialClaim = claimCapability(
      { pluginIdentity: officialPlugin, namespace: reservedSubNamespace, capabilityId, kind: 'tool', origin: 'static' },
      [],
      policy,
    )
    expect(officialClaim.admitted).toBe(true)
    if (!officialClaim.admitted) return

    const takeover = requestReplace(
      { targetCapabilityId: capabilityId, replacingPluginIdentity: attackerPlugin },
      [officialClaim.registration],
      policy,
    )
    expect(takeover.admitted).toBe(false)
    if (!takeover.admitted) expect(takeover.reason).toBe('namespace-reserved')
  })

  it('must[1]: an official plugin may still replace its own reserved dsh.* capability, so the refusal is scoped to third parties', () => {
    const capabilityId = brandString<StableCapabilityId>('dsh.core.write_file')
    const reservedSubNamespace = brandString<Namespace>('dsh.core')
    const existing = [fixtureRegistration(officialPlugin, capabilityId, brandString<OwnershipToken>('official-token'), {
      namespace: reservedSubNamespace,
    })]

    const decision = requestReplace(
      { targetCapabilityId: capabilityId, replacingPluginIdentity: officialPlugin },
      existing,
      policy,
    )
    expect(decision.admitted).toBe(true)
    if (decision.admitted) {
      expect(decision.registration.pluginIdentity).toBe(officialPlugin)
      expect(decision.registration.namespace).toBe(reservedSubNamespace)
    }
  })

  it('must[1] outranks policy: a third party is told namespace-reserved, not replace-not-authorized, when replacement is ALSO disallowed', () => {
    // Both branches refuse, so this is a diagnostic choice rather than a
    // security one. Reporting the policy refusal first would send an operator
    // to enable `allowReplace` deployment-wide and retry, only to be refused
    // again for the reason that was true all along.
    const capabilityId = brandString<StableCapabilityId>('dsh.core.delete_file')
    const existing = [fixtureRegistration(officialPlugin, capabilityId, brandString<OwnershipToken>('official-token'), {
      namespace: brandString<Namespace>('dsh.core'),
    })]

    const decision = requestReplace(
      { targetCapabilityId: capabilityId, replacingPluginIdentity: attackerPlugin },
      existing,
      policyDenyingReplace,
    )
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('namespace-reserved')
  })

  it('must[1] outranks collision: a third party claiming a reserved capability id the official plugin ALREADY owns is refused namespace-reserved, not capability-collision', () => {
    // The Contract stage's load-order case ran against an EMPTY registry, so
    // the order of the two checks was never exercised. Reversing them would
    // report a mere naming clash where the real refusal is a namespace one,
    // and the reason is what the Usage stage's registrants assert on.
    const capabilityId = brandString<StableCapabilityId>('dsh.core:boot_hook')
    const existing = [fixtureRegistration(officialPlugin, capabilityId, brandString<OwnershipToken>('official-token'), {
      namespace: reservedNamespace,
      kind: 'service',
    })]

    const decision = claimCapability(
      { pluginIdentity: attackerPlugin, namespace: reservedNamespace, capabilityId, kind: 'service', origin: 'static' },
      existing,
      policy,
    )
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('namespace-reserved')
  })

  it('must[3]: a forged ownership token carrying the real owner\'s identity prefix revokes nothing', () => {
    // `mintOwnershipToken` builds `${pluginIdentity}:${randomUUID()}`, and a
    // plugin identity is public. An attacker that reproduces the prefix
    // exactly still holds no token the registry minted, so revocation must
    // compare the whole token rather than the identity it names.
    const capabilityId = brandString<StableCapabilityId>('friendly-tools:owned_tool')
    const realToken = mintOwnershipToken(friendlyPluginA)
    const existing = [fixtureRegistration(friendlyPluginA, capabilityId, realToken)]
    const forgedToken = brandString<OwnershipToken>(`${friendlyPluginA}:00000000-0000-4000-8000-000000000000`)

    expect(forgedToken.startsWith(`${friendlyPluginA}:`)).toBe(true)
    const forgedAttempt = revokeByOwnershipToken(forgedToken, existing)
    expect(forgedAttempt.revoked).toBe(false)
    if (!forgedAttempt.revoked) expect(forgedAttempt.reason).toBe('unknown-token')
  })

  it('must[3]: a real ownership token replayed after its own registration is gone revokes nothing', () => {
    const capabilityId = brandString<StableCapabilityId>('friendly-tools:unloaded_tool')
    const realToken = mintOwnershipToken(friendlyPluginA)
    const existing = [fixtureRegistration(friendlyPluginA, capabilityId, realToken)]

    const firstUnload = revokeByOwnershipToken(realToken, existing)
    expect(firstUnload.revoked).toBe(true)
    if (firstUnload.revoked) expect(firstUnload.revokedCapabilityIds).toEqual([capabilityId])

    // The registry that survives the unload no longer holds the registration.
    const replay = revokeByOwnershipToken(realToken, [])
    expect(replay.revoked).toBe(false)
    if (!replay.revoked) expect(replay.reason).toBe('unknown-token')
  })

  it('must[3]: one plugin holding two capabilities gets two distinct tokens, so its first token cannot revoke its second capability', () => {
    // The Contract stage's must[3] case scoped a token against a DIFFERENT
    // plugin's registration. A token is minted per admitted claim, not per
    // plugin, so an unload presenting one token must leave the same plugin's
    // other capabilities alone.
    const capabilityIdA = brandString<StableCapabilityId>('friendly-tools:tool-a')
    const capabilityIdB = brandString<StableCapabilityId>('friendly-tools:tool-b')
    const claimA = claimCapability(
      { pluginIdentity: friendlyPluginA, namespace: friendlyNamespace, capabilityId: capabilityIdA, kind: 'tool', origin: 'static' },
      [],
      policy,
    )
    expect(claimA.admitted).toBe(true)
    if (!claimA.admitted) return
    const claimB = claimCapability(
      { pluginIdentity: friendlyPluginA, namespace: friendlyNamespace, capabilityId: capabilityIdB, kind: 'tool', origin: 'static' },
      [claimA.registration],
      policy,
    )
    expect(claimB.admitted).toBe(true)
    if (!claimB.admitted) return

    expect(claimA.registration.ownershipToken).not.toBe(claimB.registration.ownershipToken)
    const result = revokeByOwnershipToken(claimA.registration.ownershipToken, [claimA.registration, claimB.registration])
    expect(result.revoked).toBe(true)
    if (result.revoked) {
      expect(result.revokedCapabilityIds).toEqual([capabilityIdA])
      expect(result.revokedCapabilityIds).not.toContain(capabilityIdB)
    }
  })
})
