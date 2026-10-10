/**
 * (C) per-call capability authority — P1-06 slice-2. Every tool invocation an
 * untrusted out-of-process plugin triggers must be authorized against the REAL
 * caller's PER-DISPATCH capability, sourced from `exec.capabilityToken` at
 * invoke time — never a fixed identity bound once at attach/session time.
 *
 * Observed through the public `tool.invoke` wire frame only (the slice-1 driver
 * captures every frame in `h.invokeFrames`; see
 * tests/first100/fixtures/loader/p1-06-slice1/driver.ts). No coupling to any
 * fix-internal field or Map.
 *
 * Authority of one frame is, by the contract:
 *   frame.principal            === exec.capabilityToken.token.subject
 *   frame.capability.digest    === digestToken(exec.capabilityToken.token)
 *   frame.capability.resources deep-equals exec.capabilityToken.token.resources
 *   frame.capability.expiresAtMs === exec.capabilityToken.token.expiresAt
 * A dispatch carrying NO capabilityToken is fail-closed: the invoke errors and
 * NO frame crosses to the plugin.
 *
 * SUPERSEDES the attach-time fixed-identity assertions of the old slice-1 RF3
 * (P1-06.slice1-rpc-registration.rf3-four-element-invoke.spec.ts) — see the
 * blind spec's supersession note.
 * @module tests/first100/fixtures/P1-06.slice1-rpc-registration.percall-authority
 */

import { describe, expect, it } from 'vitest'
import {
  CapabilityName,
  CapabilityTokenNonce,
  digestToken,
  type SignedCapabilityToken,
} from '@deepseek-ai/dsh-capability-token'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { startHarness } from './loader/p1-06-slice1/driver.ts'

/**
 * A hand-built SignedCapabilityToken literal. `digestToken` only hashes the
 * token's fields (it does not verify the signature), so the signature bytes are
 * irrelevant here. Field values are chosen DISTINCT from the driver's attach-time
 * fixed identity (principal 'test-principal', digest 'test-capability-digest',
 * resources ['echo'], expiry 4102444800000) so every per-call assertion also
 * FAILS under the pre-fix attach-sourced stamping (true red), never a false green.
 */
function makeToken(args: {
  subject: string
  resources: readonly string[]
  expiresAt: number
  nonce: string
  capability?: string
}): SignedCapabilityToken {
  return {
    token: {
      subject: PrincipalId(args.subject),
      tenant: TenantId('tenant-percall'),
      capability: CapabilityName(args.capability ?? 'skill'),
      verbs: ['invoke'],
      resources: [...args.resources],
      constraints: {},
      expiresAt: args.expiresAt,
      nonce: CapabilityTokenNonce(args.nonce),
      delegationDepth: 0,
      parentDigest: null,
    },
    signature: new Uint8Array([1, 2, 3]),
  }
}

// Distinct from the attach constants on every field the frame carries.
const TOKEN_A = makeToken({
  subject: 'agent-alpha',
  resources: ['fs:/alpha', 'skill:echo'],
  expiresAt: 7258118400000, // year ~2200, != attach's 4102444800000
  nonce: 'nonce-alpha',
  capability: 'skill',
})
const TOKEN_B = makeToken({
  subject: 'agent-beta',
  resources: ['web:get'],
  expiresAt: 7258118400001,
  nonce: 'nonce-beta',
  capability: 'web',
})

describe('P1-06 slice-2 (C): per-call capability authority on tool.invoke', () => {
  // Assertion 1 — the frame carries the CURRENT dispatch's supplied token.
  it('stamps the invoke frame with the per-dispatch token authority', async () => {
    const h = await startHarness('percall-a')
    try {
      await h.waitRegistered()
      expect(h.toolNames()).toContain('echo')

      const result = await h.execute('echo', {}, TOKEN_A)
      expect(result.isError).toBe(false)

      expect(h.invokeFrames).toHaveLength(1)
      const frame = h.invokeFrames[0]!
      expect(frame.principal).toBe(TOKEN_A.token.subject)
      expect(frame.capability.digest).toBe(digestToken(TOKEN_A.token))
      expect([...frame.capability.resources]).toEqual([...TOKEN_A.token.resources])
      expect(frame.capability.expiresAtMs).toBe(TOKEN_A.token.expiresAt)
    } finally {
      await h.stop()
    }
  })

  // Assertion 2 — two dispatches, two DIFFERENT per-call tokens, in ONE host
  // session (same attach identity) carry DIFFERENT authority in their two
  // frames: identity is per-dispatch, not one fixed attach identity for both.
  it('gives two different per-dispatch tokens two different frame authorities', async () => {
    const h = await startHarness('percall-pair')
    try {
      await h.waitRegistered()

      const rA = await h.execute('echo', {}, TOKEN_A)
      const rB = await h.execute('echo', {}, TOKEN_B)
      expect(rA.isError).toBe(false)
      expect(rB.isError).toBe(false)

      expect(h.invokeFrames).toHaveLength(2)
      const [fA, fB] = h.invokeFrames as readonly [typeof h.invokeFrames[number], typeof h.invokeFrames[number]]

      // Each frame carries ITS OWN dispatch's token.
      expect(fA.principal).toBe(TOKEN_A.token.subject)
      expect(fB.principal).toBe(TOKEN_B.token.subject)
      expect(fA.capability.digest).toBe(digestToken(TOKEN_A.token))
      expect(fB.capability.digest).toBe(digestToken(TOKEN_B.token))

      // And they DIFFER (refutes a single fixed attach identity for both).
      expect(fB.principal).not.toBe(fA.principal)
      expect(fB.capability.digest).not.toBe(fA.capability.digest)
      expect([...fB.capability.resources]).not.toEqual([...fA.capability.resources])
    } finally {
      await h.stop()
    }
  })

  // Assertion 3 — a dispatch with NO capabilityToken is fail-closed: the invoke
  // errors and NO frame (with ambient/default authority) crosses to the plugin.
  it('fails closed when the dispatch carries no capability token', async () => {
    const h = await startHarness('percall-noauth')
    try {
      await h.waitRegistered()
      expect(h.toolNames()).toContain('echo')

      const result = await h.execute('echo', {}) // no per-call token
      expect(result.isError).toBe(true)
      expect(h.invokeFrames).toHaveLength(0)
    } finally {
      await h.stop()
    }
  })
})
