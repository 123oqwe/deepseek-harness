/**
 * The positive control the Sigstore slice was blocked on: a bundle produced by a
 * LOCAL certificate authority and a LOCAL transparency log, verified by the REAL
 * `@sigstore/verify` against a trusted root built by hand.
 *
 * It exists because a verification path proven only by refusals is
 * indistinguishable from one that refuses everything. Until this ran, nothing
 * showed that this repository could make the real verifier say yes — so no
 * refusal it produced would have meant anything.
 *
 * Local infrastructure, real verification logic: the same reasoning as the
 * bubblewrap probe. What is under test is the product's path, never Sigstore's
 * availability, and no network is touched.
 *
 * **Three findings are encoded in this file and each cost a round to learn.**
 * A certificate with no SCT crashes SCT verification, so the CA needs a CT log.
 * Thresholds of `0` collect no timestamps at all and leave the certificate path
 * empty — the error surfaces far from the cause, as `undefined.clone()`. And an
 * entry logged through `logV2` carries no inclusion promise, which
 * `@sigstore/verify` requires before it will count a timestamp at all; mixing a
 * v2 entry with v1 fields then fails as `invalid index`, because the index, the
 * body and the promise must describe ONE entry.
 */
import { describe, expect, it } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import { initializeCA, initializeCTLog, initializeTLog } from '@sigstore/mock'
import { toMessageSignatureBundle } from '@sigstore/bundle'
import { toSignedEntity, toTrustMaterial, Verifier } from '@sigstore/verify'

describe('Sigstore local chain — the real verifier accepts a locally-issued bundle', () => {
  it('verifies a bundle whose certificate and log entry were produced locally', async () => {
    const caKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const tlogKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const signerKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const ctKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const ctLog = await initializeCTLog(ctKeys)
    const ca = await initializeCA(caKeys, ctLog)
    const tlog = await initializeTLog('https://tlog.local', tlogKeys)

    const cert = await ca.issueCertificate({
      publicKey: signerKeys.publicKey.export({ type: 'spki', format: 'der' }),
      subjectAltName: 'https://github.com/acme/plugin/.github/workflows/release.yml@refs/heads/main',
    })
    const artifact = Buffer.from('the package bytes')
    const digest = createHash('sha256').update(artifact).digest()
    const signature = createSign('sha256').update(artifact).sign(signerKeys.privateKey)

    const bundle = toMessageSignatureBundle({
      digest,
      signature,
      certificate: Buffer.from(cert.buffer, cert.byteOffset, cert.byteLength),
    })
    const certBuffer = Buffer.from(cert.buffer, cert.byteOffset, cert.byteLength)
    // `logV2` is deliberately NOT used: its entry carries no inclusion
    // promise, and without one `@sigstore/verify` counts no timestamp, which
    // leaves the certificate path empty and fails as `undefined.clone()` far
    // from the cause.
    // v1 log(): its `verification.signedEntryTimestamp` IS the inclusion
    // promise, and `@sigstore/verify` counts a timestamp only for entries that
    // carry one (timestamp/index.js: "Only entries with an inclusion promise
    // provide a verifiable timestamp").
    const v1: unknown = await tlog.log({
      kind: 'hashedrekord',
      apiVersion: '0.0.1',
      spec: {
        data: { hash: { algorithm: 'sha256', value: digest.toString('hex') } },
        signature: { content: signature.toString('base64'), publicKey: { content: certBuffer.toString('base64') } },
      },
    })
    // `log()` answers a map keyed by entry UUID; the fixture logs one entry, so
    // its single value is that entry.
    const v1Body = Object.values(v1 as Record<string, unknown>)[0] as {
      body: string
      integratedTime: number
      logID: string
      logIndex: number
      verification: { signedEntryTimestamp: string }
    }
    // Built purely from the v1 entry: mixing v1 and v2 fields produced
    // `invalid index`, because the index, body and promise must describe one
    // entry rather than two.
    bundle.verificationMaterial.tlogEntries = [{
      logIndex: String(v1Body.logIndex),
      logId: { keyId: Buffer.from(v1Body.logID, 'hex') },
      kindVersion: { kind: 'hashedrekord', version: '0.0.1' },
      integratedTime: String(v1Body.integratedTime),
      canonicalizedBody: Buffer.from(v1Body.body, 'base64'),
      inclusionPromise: { signedEntryTimestamp: Buffer.from(v1Body.verification.signedEntryTimestamp, 'base64') },
    } as never]

    const trustedRoot = {
      mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
      tlogs: [{
        baseUrl: 'https://tlog.local',
        hashAlgorithm: 1,
        publicKey: { rawBytes: tlog.publicKey, keyDetails: 5, validFor: { start: new Date(0) } },
        logId: { keyId: createHash('sha256').update(tlog.publicKey).digest() },
      }],
      certificateAuthorities: [{
        subject: { organization: 'probe', commonName: 'probe-ca' },
        uri: 'https://fulcio.local',
        certChain: {
          certificates: [{
            rawBytes: Buffer.from(ca.rootCertificate.buffer, ca.rootCertificate.byteOffset, ca.rootCertificate.byteLength),
          }],
        },
        validFor: { start: new Date(0) },
      }],
      ctlogs: [{
        baseUrl: 'https://ctlog.local',
        hashAlgorithm: 1,
        publicKey: { rawBytes: ctKeys.publicKey.export({ type: 'spki', format: 'der' }), keyDetails: 5, validFor: { start: new Date(0) } },
        logId: { keyId: Buffer.from(ctLog.logID.buffer, ctLog.logID.byteOffset, ctLog.logID.byteLength) },
      }],
      timestampAuthorities: [],
    }
    const material = toTrustMaterial(trustedRoot as never)
    const entity = toSignedEntity(bundle, artifact)
    const verifier = new Verifier(material, { tlogThreshold: 1, ctlogThreshold: 1, timestampThreshold: 1 })
    const signer = verifier.verify(entity)
    expect(signer).toBeDefined()
  })
})
