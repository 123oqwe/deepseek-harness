/**
 * Contract-stage RED scaffold for Epic P1-09's Service/Tool/Event namespace
 * and ownership conflict detection. One `it()` per registry-declared
 * acceptance clause (splitting acceptance[0]'s three named fail-closed
 * scenarios into three cases) plus every must[] clause that is structurally
 * testable at this Contract level. Every case below calls a real exported
 * function against real branded fixture data; every function currently
 * throws `'not implemented: ...'` (`../src/index.ts`), so every case fails
 * for that reason today — the assertions themselves describe the behavior a
 * later fix-round must satisfy.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  buildInventoryChain,
  claimCapability,
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
})
