/**
 * A local Sigstore chain: a certificate authority, a CT log and a transparency
 * log that exist only inside the test process.
 *
 * Local infrastructure, real verification logic. What the provenance tests
 * exercise is this product's verification path, never Sigstore's availability,
 * and nothing here touches the network. The same reasoning as the bubblewrap
 * probe: a test that fails when a public service is down is testing the wrong
 * thing.
 *
 * **No secret exists to protect.** The signing key is generated per process and
 * discarded with it; a verifier needs only public material, which is why this
 * whole file can live in a repository.
 *
 * @module plugin-provenance/tests/fixtures/sigstore-chain
 */
import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import { initializeCA, initializeCTLog, initializeTLog } from '@sigstore/mock'
import { toMessageSignatureBundle } from '@sigstore/bundle'

/** The identity every bundle from this chain is issued to. */
export const CHAIN_ISSUER = 'https://token.actions.githubusercontent.com'
/** The subject every bundle from this chain is issued to. */
export const CHAIN_SUBJECT = 'repo:acme/plugin-a:ref:refs/heads/main'

/** A chain that can sign artifacts and the trusted root that verifies them. */
export interface LocalSigstoreChain {
  /** The trusted-root document, as a deployment would configure it on an anchor. */
  readonly trustedRoot: unknown
  /**
   * Sign `artifact` and return the bundle proving it.
   * @param artifact - the exact bytes the claim is made over.
   * @param identity - overrides for the certificate's identity, to build a bundle that verifies against a DIFFERENT name.
   * @returns the Sigstore bundle.
   */
  sign(artifact: Uint8Array, identity?: { issuer?: string; subject?: string }): Promise<unknown>
}

/**
 * Build a local Sigstore chain.
 *
 * Four things had to be right for the real verifier to accept what this
 * produces, and each is here because getting it wrong fails far from its cause:
 * the CA needs a CT log or SCT verification reads an absent extension; the
 * verifier's thresholds must be at least 1 or it collects no timestamps and
 * leaves the certificate path empty; the log entry must carry an inclusion
 * promise, which only the v1 `log()` produces; and the entry's index, body and
 * promise must all come from that same v1 entry.
 * @returns the chain and its trusted root.
 */
export async function createLocalSigstoreChain(): Promise<LocalSigstoreChain> {
  const caKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const ctKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const tlogKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const ctLog = await initializeCTLog(ctKeys)
  const ca = await initializeCA(caKeys, ctLog)
  const tlog = await initializeTLog('https://tlog.local', tlogKeys)
  const rootCertificate = Buffer.from(
    ca.rootCertificate.buffer,
    ca.rootCertificate.byteOffset,
    ca.rootCertificate.byteLength,
  )

  const trustedRoot = {
    mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
    tlogs: [{
      baseUrl: 'https://tlog.local',
      hashAlgorithm: 1,
      publicKey: { rawBytes: tlogKeys.publicKey.export({ type: 'spki', format: 'der' }), keyDetails: 5, validFor: { start: new Date(0) } },
      logId: { keyId: createHash('sha256').update(tlog.publicKey).digest() },
    }],
    certificateAuthorities: [{
      subject: { organization: 'local', commonName: 'local-ca' },
      uri: 'https://fulcio.local',
      certChain: { certificates: [{ rawBytes: rootCertificate }] },
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

  return {
    trustedRoot,
    async sign(artifact, identity) {
      const signerKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const subject = identity?.subject ?? CHAIN_SUBJECT
      const cert = await ca.issueCertificate({
        publicKey: signerKeys.publicKey.export({ type: 'spki', format: 'der' }),
        subjectAltName: subject,
        extensions: [{ oid: '1.3.6.1.4.1.57264.1.8', value: identity?.issuer ?? CHAIN_ISSUER }],
      })
      const certBuffer = Buffer.from(cert.buffer, cert.byteOffset, cert.byteLength)
      const payload = Buffer.from(artifact)
      const digest = createHash('sha256').update(payload).digest()
      const signature = createSign('sha256').update(payload).sign(signerKeys.privateKey)
      const bundle = toMessageSignatureBundle({ digest, signature, certificate: certBuffer })
      const logged: unknown = await tlog.log({
        kind: 'hashedrekord',
        apiVersion: '0.0.1',
        spec: {
          data: { hash: { algorithm: 'sha256', value: digest.toString('hex') } },
          signature: { content: signature.toString('base64'), publicKey: { content: certBuffer.toString('base64') } },
        },
      })
      const entry = Object.values(logged as Record<string, unknown>)[0] as {
        body: string
        integratedTime: number
        logID: string
        logIndex: number
        verification: { signedEntryTimestamp: string }
      }
      bundle.verificationMaterial.tlogEntries = [{
        logIndex: String(entry.logIndex),
        logId: { keyId: Buffer.from(entry.logID, 'hex') },
        kindVersion: { kind: 'hashedrekord', version: '0.0.1' },
        integratedTime: String(entry.integratedTime),
        canonicalizedBody: Buffer.from(entry.body, 'base64'),
        inclusionPromise: { signedEntryTimestamp: Buffer.from(entry.verification.signedEntryTimestamp, 'base64') },
      } as never]
      return bundle
    },
  }
}
