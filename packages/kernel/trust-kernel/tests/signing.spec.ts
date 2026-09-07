/**
 * P2-02 must[1]: the Trust Kernel issues and verifies real signatures.
 *
 * What stands here today is a fixed marker: `issueToken`/`attenuateToken`
 * write a constant byte sequence and `verifyToken` compares a candidate
 * against that same constant. It is the shape BLOCKED-135 recorded for the
 * plugin lock's `unavailable:` integrity — a check equal to itself, which
 * cannot fail — and `createTrustKernel` mints `signatureRoots` as
 * `Object.freeze({})`, so the marker binds nothing.
 *
 * Both suppliers the lock named are now met: SLICE-fiber-A landed Option A,
 * and these cases are the second step BLOCKED-092 requires — the lock does not
 * lift because the suppliers arrived, it lifts because this epic writes the
 * case it could not write before.
 *
 * Every case mints its own keypair at run time. No key material is committed,
 * none is read from the environment, and nothing here holds a real private
 * key.
 */

import { describe, expect, it } from 'vitest'
import { createTrustKernel, signWithSignatureRoots, verifyWithSignatureRoots } from '../src/index.ts'

describe('P2-02 must[1]: the kernel signs with real key material', () => {
  it('verifies a signature it produced, and refuses the same bytes with one byte changed', () => {
    // The pair, not the refusal alone: "a forged signature is refused" is
    // satisfied by a verifier that refuses everything, which is the mirror of
    // today's marker path accepting everything.
    const kernel = createTrustKernel()
    const claim = Buffer.from('subject=alice;capability=fs:read', 'utf8')
    const signature = signWithSignatureRoots(kernel.signatureRoots, claim)
    expect(verifyWithSignatureRoots(kernel.signatureRoots, claim, signature)).toBe(true)
    const tampered = Buffer.from('subject=alice;capability=fs:writ', 'utf8')
    expect(verifyWithSignatureRoots(kernel.signatureRoots, tampered, signature)).toBe(false)
  })

  it('refuses a signature made by a DIFFERENT kernel, which the marker cannot distinguish', () => {
    // Separates "the bytes were tampered with" from "the signer was not this
    // kernel". The marker is the same constant in every process, so it calls
    // another installation's token genuine.
    const mine = createTrustKernel()
    const theirs = createTrustKernel()
    const claim = Buffer.from('subject=alice', 'utf8')
    const foreign = signWithSignatureRoots(theirs.signatureRoots, claim)
    expect(verifyWithSignatureRoots(mine.signatureRoots, claim, foreign)).toBe(false)
    // The control: the same bytes signed by MY kernel do verify, so the
    // refusal above is caused by the signer and not by the claim.
    expect(verifyWithSignatureRoots(mine.signatureRoots, claim, signWithSignatureRoots(mine.signatureRoots, claim))).toBe(true)
  })

  it('keeps the PRIVATE key off the signatureRoots handle, which crosses the plugin boundary', () => {
    // P0-02's frozen case pins that the interface has exactly one member, its
    // brand. This is the runtime counterpart: the handle is passed to plugins,
    // and the only thing between "the key lives in the kernel" and a refactor
    // that puts it on the handle is a case that looks.
    const kernel = createTrustKernel()
    const serialized = JSON.stringify(kernel.signatureRoots)
    expect(serialized).not.toMatch(/PRIVATE KEY/u)
    expect(Object.keys(kernel.signatureRoots)).toHaveLength(0)
  })
})
