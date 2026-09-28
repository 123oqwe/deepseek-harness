/**
 * Implementation cases for `sealTrustAnchors`: a sealed signature-roots
 * handle refuses registration and revocation and keeps its anchors, and a
 * handle nobody sealed is unchanged. P1-02 must[3]'s clause evidence is the
 * shipped-composition case lane A writes, not this file.
 */

import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { describe, expect, it } from 'vitest'
import { listTrustAnchorIds, registerTrustAnchor, revokeTrustAnchor, sealTrustAnchors } from '../src/signature.ts'

const REFUSAL = 'the trust anchors of a pinned trust kernel cannot change at runtime; change the profile\'s dsh.trustAnchors and restart'

describe('sealTrustAnchors', () => {
  it('a sealed handle refuses registration and revocation and keeps its anchors', () => {
    const kernel = createTrustKernel()
    const anchorId = registerTrustAnchor(kernel.signatureRoots, { mode: 'sigstore', trustedIssuer: 'https://issuer.example' })
    sealTrustAnchors(kernel.signatureRoots)
    expect(() => registerTrustAnchor(kernel.signatureRoots, { mode: 'sigstore', trustedIssuer: 'https://other.example' }))
      .toThrow(`registerTrustAnchor: ${REFUSAL}`)
    expect(() => revokeTrustAnchor(kernel.signatureRoots, anchorId)).toThrow(`revokeTrustAnchor: ${REFUSAL}`)
    expect(listTrustAnchorIds(kernel.signatureRoots)).toEqual([anchorId])
  })

  it('a handle nobody sealed still admits and withdraws anchors', () => {
    sealTrustAnchors(createTrustKernel().signatureRoots)
    const kernel = createTrustKernel()
    const anchorId = registerTrustAnchor(kernel.signatureRoots, { mode: 'sigstore', trustedIssuer: 'https://issuer.example' })
    expect(revokeTrustAnchor(kernel.signatureRoots, anchorId)).toBe(true)
    expect(listTrustAnchorIds(kernel.signatureRoots)).toEqual([])
  })
})
