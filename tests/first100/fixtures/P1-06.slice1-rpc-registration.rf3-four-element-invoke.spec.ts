/**
 * RF3 — four-element invoke-frame SHAPE (acceptance[2]). Under (C) the frame's
 * identity VALUES are sourced per-dispatch from `exec.capabilityToken` and are
 * owned by P1-06.slice1-rpc-registration.percall-authority.spec.ts. This spec
 * SUPERSEDES RF3's old attach-time fixed-identity VALUE assertions (principal ===
 * 'test-principal', digest === 'test-capability-digest', resources contains
 * 'echo') and retains only the host-stamped frame SHAPE plus the guarantee that
 * the plugin cannot fill or override the identity. Dispatched under a per-call
 * token because a tokenless dispatch is fail-closed under (C), so no frame would
 * cross. The staging plugin echoes the received params back so the driver
 * captures the frame.
 * @module tests/first100/fixtures/P1-06.slice1-rpc-registration.rf3
 */

import { describe, expect, it } from 'vitest'
import {
  CapabilityName,
  CapabilityTokenNonce,
  type SignedCapabilityToken,
} from '@deepseek-ai/dsh-capability-token'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { startHarness } from './loader/p1-06-slice1/driver.ts'

/** A per-call token so the dispatch is not fail-closed; its values are not asserted here (the percall spec owns them). */
const RF3_TOKEN: SignedCapabilityToken = {
  token: {
    subject: PrincipalId('rf3-caller'),
    tenant: TenantId('tenant-rf3'),
    capability: CapabilityName('skill'),
    verbs: ['invoke'],
    resources: ['skill:echo'],
    constraints: {},
    expiresAt: 7258118400000,
    nonce: CapabilityTokenNonce('nonce-rf3'),
    delegationDepth: 0,
    parentDigest: null,
  },
  signature: new Uint8Array([1, 2, 3]),
}

describe('P1-06 slice 1 RF3: four-element invoke frame (shape)', () => {
  it('host-stamps a four-element frame, keeps capability a digest view, and ignores plugin-supplied overrides', async () => {
    const h = await startHarness('rf3')
    try {
      await h.waitRegistered()
      expect(h.toolNames()).toContain('echo')
      // Dispatch under a per-call token; the args try to supply their own
      // principal/traceId, which the host must not honor.
      const result = await h.execute('echo', { principal: 'attacker', traceId: 'attacker-trace' }, RF3_TOKEN)
      expect(result.isError).toBe(false)

      // Shape: the captured tool.invoke frame carries all four host-stamped elements.
      expect(h.invokeFrames).toHaveLength(1)
      const frame = h.invokeFrames[0]!
      expect(typeof frame.principal).toBe('string')
      expect(frame.capability).toBeDefined()
      expect(typeof frame.deadlineMs).toBe('number')
      expect(typeof frame.traceId).toBe('string')
      expect(frame.traceId.length).toBeGreaterThan(0)

      // Shape: capability is a digest view (digest + resources + expiry), never a signed token on the frame.
      expect(typeof frame.capability.digest).toBe('string')
      expect(Array.isArray(frame.capability.resources)).toBe(true)
      expect(typeof frame.capability.expiresAtMs).toBe('number')
      const capabilityKeys = Object.keys(frame.capability)
      expect(capabilityKeys.sort()).toEqual(['digest', 'expiresAtMs', 'resources'])

      // The plugin's own args cannot fill or override the host-stamped identity.
      expect(frame.principal).not.toBe('attacker')
      expect(frame.traceId).not.toBe('attacker-trace')
    } finally {
      await h.stop()
    }
  })
})
