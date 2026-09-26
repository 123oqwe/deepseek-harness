/**
 * P1-02 must[2]: a profile's trust anchors come from its own `package.json`
 * `dsh.trustAnchors`, and a malformed list fails loud rather than meaning
 * zero anchors.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProfileTrustAnchors } from '../src/trust-anchors.ts'

const dirs: string[] = []

/**
 * A profile directory whose manifest carries the given `dsh` field.
 * @param dsh - the `dsh` field, or `undefined` for none.
 * @returns the directory.
 */
function profileWith(dsh: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-trust-anchors-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', private: true, ...dsh === undefined ? {} : { dsh } }))
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const OFFLINE = { mode: 'offline-signed', publicKeyFingerprint: 'sha256:key', owner: 'team', publicKeyPem: 'PEM' }

describe('P1-02 must[2]: the profile manifest declares the trust anchors', () => {
  it('reads no anchors from a profile that declares none', () => {
    expect(readProfileTrustAnchors(profileWith(undefined))).toEqual([])
    expect(readProfileTrustAnchors(profileWith({ profile: { bundles: [] } }))).toEqual([])
  })

  it('reads offline and sigstore anchors in declaration order', () => {
    const sigstore = { mode: 'sigstore', trustedIssuer: 'https://issuer.example', trustedRoot: { keys: [] } }
    expect(readProfileTrustAnchors(profileWith({ trustAnchors: [OFFLINE, sigstore, { mode: 'sigstore', trustedIssuer: 'x' }] })))
      .toEqual([OFFLINE, sigstore, { mode: 'sigstore', trustedIssuer: 'x' }])
  })

  it('fails loud on a list that is not an array, an unknown mode, or a missing field', () => {
    expect(() => readProfileTrustAnchors(profileWith({ trustAnchors: OFFLINE }))).toThrow(/dsh\.trustAnchors must be an array/u)
    expect(() => readProfileTrustAnchors(profileWith({ trustAnchors: [{ mode: 'pgp' }] }))).toThrow(/\[0\]\.mode must be/u)
    expect(() => readProfileTrustAnchors(profileWith({ trustAnchors: ['sha256:key'] }))).toThrow(/\[0\]\.mode must be/u)
    expect(() => readProfileTrustAnchors(profileWith({ trustAnchors: [OFFLINE, { ...OFFLINE, publicKeyPem: '' }] })))
      .toThrow(/\[1\]\.publicKeyPem must be a non-empty string/u)
    expect(() => readProfileTrustAnchors(profileWith({ trustAnchors: [{ mode: 'sigstore' }] })))
      .toThrow(/\[0\]\.trustedIssuer must be a non-empty string/u)
  })
})
