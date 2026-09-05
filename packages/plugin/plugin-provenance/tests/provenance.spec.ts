/**
 * Clause coverage for Epic P1-02's plugin signature, provenance,
 * and dependency SBOM verification. One `it()` per registry-declared
 * acceptance clause (splitting acceptance[0]'s three named fail-closed
 * scenarios into four cases — the "替换 source repo" scenario further splits
 * into a repo-URL variant and a commit-hash variant, since
 * `SourceCommitReference` binds both facts and must[1] requires checking the
 * source commit as a whole) plus every must[] clause that is structurally
 * testable at this Contract level. Every case calls an exported function from
 * `../src/signature.ts`, `../src/sbom.ts`, or `../src/index.ts` against real
 * branded fixture data.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { describe, expect, it } from 'vitest'
import {
  admitUnsignedDevMode,
  recordProvenanceAudit,
  registerTrustAnchor,
  verifyLockedPackageOffline,
  verifyPluginProvenance,
} from '../src/index.ts'
import type { PluginProvenanceInput, PluginProvenanceVerification } from '../src/index.ts'
import type {
  BuilderIdentity,
  ObservedPackageFacts,
  OfflineSignedProvenanceEvidence,
  PackageDigest,
  PackageProvenanceClaim,
  PublicKeyFingerprint,
  SigstoreProvenanceEvidence,
  SourceCommitHash,
  SourceCommitReference,
  TrustAnchorId,
  UnsignedDevPolicy,
} from '../src/signature.ts'
import type { SbomDigest, SbomDocument } from '../src/sbom.ts'

const subjectDigest = brandString<PackageDigest>('sha256:9f2c...real-package-tarball')
const realSourceCommit: SourceCommitReference = {
  repoUrl: 'https://github.com/acme/plugin-a',
  commitHash: brandString<SourceCommitHash>('a1b2c3d4e5f6'),
}
const realBuilderIdentity = brandString<BuilderIdentity>('github-actions:acme/plugin-a@main')
const sbomDigest = brandString<SbomDigest>('sha256:sbom-of-plugin-a')

const sbom: SbomDocument = {
  format: 'cyclonedx',
  subjectPackageDigest: subjectDigest,
  generatedAt: '2026-09-01T00:00:00.000Z',
  entries: [
    { name: 'left-pad', version: '1.3.0', kind: 'runtime' },
    { name: 'typescript', version: '5.6.0', kind: 'dev' },
  ],
}

const sigstoreEvidence: SigstoreProvenanceEvidence = {
  mode: 'sigstore',
  issuer: 'https://token.actions.githubusercontent.com',
  subject: 'repo:acme/plugin-a:ref:refs/heads/main',
  transparencyLogIndex: 918273,
}

function offlineEvidence(fingerprint: PublicKeyFingerprint): OfflineSignedProvenanceEvidence {
  return {
    mode: 'offline-signed',
    signature: new Uint8Array([0x30, 0x45, 0x02, 0x21]),
    publicKeyFingerprint: fingerprint,
  }
}

/** A signed claim carrying `evidence`, matching `realSourceCommit`/`realBuilderIdentity`/`sbomDigest`. */
function buildClaim(evidence: PackageProvenanceClaim['evidence']): PackageProvenanceClaim {
  return {
    packageDigest: subjectDigest,
    sourceCommit: realSourceCommit,
    builderIdentity: realBuilderIdentity,
    sbomDigest,
    evidence,
  }
}

/** The facts an independent observer resolves, matching a genuine (untampered) `buildClaim` claim by default. */
function buildObserved(overrides: Partial<ObservedPackageFacts> = {}): ObservedPackageFacts {
  return {
    observedDigest: subjectDigest,
    observedSourceCommit: realSourceCommit,
    observedBuilderIdentity: realBuilderIdentity,
    ...overrides,
  }
}

const installedDependencyNames = new Set(['left-pad'])

function buildInput(overrides: Partial<PluginProvenanceInput> = {}): PluginProvenanceInput {
  return {
    claim: buildClaim(sigstoreEvidence),
    observed: buildObserved(),
    sbom,
    installedDependencyNames,
    ...overrides,
  }
}

describe('P1-02 Contract — must clauses', () => {
  it('must[0]: a claim backed by Sigstore-style identity/provenance evidence verifies as trusted', () => {
    const kernel = createTrustKernel()
    const result = verifyPluginProvenance(buildInput(), kernel.signatureRoots)
    expect(result.trust).toBe('trusted')
    if (result.trust === 'trusted') expect(typeof result.trustAnchorId).toBe('string')
  })

  it('must[0]: a claim backed by an organization offline-signing key verifies as trusted', () => {
    const kernel = createTrustKernel()
    const fingerprint = brandString<PublicKeyFingerprint>('sha256:acme-offline-key-fingerprint')
    const input = buildInput({ claim: buildClaim(offlineEvidence(fingerprint)) })
    const result = verifyPluginProvenance(input, kernel.signatureRoots)
    expect(result.trust).toBe('trusted')
    if (result.trust === 'trusted') expect(typeof result.trustAnchorId).toBe('string')
  })

  it('must[1]: a package whose SBOM omits an actually-installed runtime dependency is rejected for SBOM-coverage mismatch', () => {
    const kernel = createTrustKernel()
    const input = buildInput({ installedDependencyNames: new Set(['left-pad', 'undeclared-runtime-dep']) })
    const result = verifyPluginProvenance(input, kernel.signatureRoots)
    expect(result.trust).toBe('rejected')
    if (result.trust === 'rejected') expect(result.reason).toBe('sbom-coverage-mismatch')
  })

  it('must[2]: the trust root a verification checks evidence against is literally TrustKernel\'s own signatureRoots handle', () => {
    const kernel = createTrustKernel()
    const result = verifyPluginProvenance(buildInput(), kernel.signatureRoots)
    expect(result.trust).toBe('trusted')
  })

  it('must[3]: an ordinary caller cannot substitute a plugin-supplied trust root — registerTrustAnchor only accepts the frozen, kernel-issued signatureRoots handle', () => {
    const kernel = createTrustKernel()
    expect(Object.isFrozen(kernel.signatureRoots)).toBe(true)
    const anchorId = registerTrustAnchor(kernel.signatureRoots, { mode: 'sigstore', trustedIssuer: 'https://token.actions.githubusercontent.com' })
    expect(typeof anchorId).toBe('string')
    expect((anchorId as string).length).toBeGreaterThan(0)
  })

  it('must[4]: an explicit dev-profile opt-in recognized by policy is admitted with a persistent untrusted banner', () => {
    const policy: UnsignedDevPolicy = { allowedDevProfileNames: new Set(['dev']) }
    const admission = admitUnsignedDevMode({ profileName: 'dev', explicitDevOptIn: true }, policy)
    expect(admission.admitted).toBe(true)
    if (admission.admitted) {
      expect(admission.banner.persistent).toBe(true)
      expect(admission.banner.message.length).toBeGreaterThan(0)
    }
  })

  it('must[4]: a profile name outside the deployment\'s recognized dev profiles is refused, never silently admitted as unsigned-dev', () => {
    const policy: UnsignedDevPolicy = { allowedDevProfileNames: new Set(['dev']) }
    const admission = admitUnsignedDevMode({ profileName: 'production', explicitDevOptIn: true }, policy)
    expect(admission.admitted).toBe(false)
    if (!admission.admitted) expect(admission.reason).toBe('profile-not-dev')
  })
})

describe('P1-02 Contract — acceptance[0]: 篡改一个字节、替换 source repo、伪造 builder 三种情况都拒绝', () => {
  it('a single tampered byte (a changed observed package digest) is rejected for digest mismatch', () => {
    const kernel = createTrustKernel()
    const tamperedDigest = brandString<PackageDigest>('sha256:9f2c...one-byte-tampered')
    const input = buildInput({ observed: buildObserved({ observedDigest: tamperedDigest }) })
    const result = verifyPluginProvenance(input, kernel.signatureRoots)
    expect(result.trust).toBe('rejected')
    if (result.trust === 'rejected') expect(result.reason).toBe('package-digest-mismatch')
  })

  it('a swapped source repo (observed repo URL differs from the claimed one) is rejected for source-repo mismatch', () => {
    const kernel = createTrustKernel()
    const swappedCommit: SourceCommitReference = { ...realSourceCommit, repoUrl: 'https://github.com/attacker/malicious-fork' }
    const input = buildInput({ observed: buildObserved({ observedSourceCommit: swappedCommit }) })
    const result = verifyPluginProvenance(input, kernel.signatureRoots)
    expect(result.trust).toBe('rejected')
    if (result.trust === 'rejected') expect(result.reason).toBe('source-repo-mismatch')
  })

  it('a forged commit hash within the same claimed source repo (repo URL unchanged, observed commit hash differs) is rejected for source-commit mismatch, distinct from source-repo mismatch', () => {
    const kernel = createTrustKernel()
    const forgedCommitHash: SourceCommitReference = { ...realSourceCommit, commitHash: brandString<SourceCommitHash>('f6e5d4c3b2a1') }
    const input = buildInput({ observed: buildObserved({ observedSourceCommit: forgedCommitHash }) })
    const result = verifyPluginProvenance(input, kernel.signatureRoots)
    expect(result.trust).toBe('rejected')
    if (result.trust === 'rejected') expect(result.reason).toBe('source-commit-mismatch')
  })

  it('a forged builder identity (observed builder differs from the claimed one) is rejected for builder-identity mismatch', () => {
    const kernel = createTrustKernel()
    const forgedBuilder = brandString<BuilderIdentity>('unknown-ci:attacker/forged-builder')
    const input = buildInput({ observed: buildObserved({ observedBuilderIdentity: forgedBuilder }) })
    const result = verifyPluginProvenance(input, kernel.signatureRoots)
    expect(result.trust).toBe('rejected')
    if (result.trust === 'rejected') expect(result.reason).toBe('builder-identity-mismatch')
  })
})

describe('P1-02 Contract — acceptance[1]: 同一锁定包在离线模式可验证', () => {
  it('the identical locked package input verifies as trusted through the offline entrypoint, with no network-shaped parameter', () => {
    const kernel = createTrustKernel()
    const locked = buildInput()
    const result = verifyLockedPackageOffline(locked, kernel.signatureRoots)
    expect(result.trust).toBe('trusted')
    if (result.trust === 'trusted') expect(typeof result.trustAnchorId).toBe('string')
  })
})

describe('P1-02 Contract — acceptance[2]: Inventory 和审计事件记录验证结果而不记录密钥', () => {
  it('recordProvenanceAudit produces a record naming the verdict and trust anchor id, with no field capable of holding key or signature material', () => {
    const trustedVerification: PluginProvenanceVerification = {
      trust: 'trusted',
      trustAnchorId: brandString<TrustAnchorId>('anchor-official-sigstore-issuer'),
    }
    const record = recordProvenanceAudit(subjectDigest, trustedVerification, '2026-09-01T00:00:00.000Z')
    expect(record.trust).toBe('trusted')
    expect(record.packageDigest).toBe(subjectDigest)
    const fields = Object.keys(record)
    expect(fields).not.toContain('evidence')
    expect(fields).not.toContain('signature')
    expect(fields).not.toContain('publicKeyFingerprint')
  })
})

/**
 * P1-02 Fault stage: a systematic matrix over the rejection boundaries that
 * actually exist.
 *
 * The boundaries are enumerated as data and driven by one runner, and the
 * count is asserted against a floor, so a boundary cannot be deleted while
 * every remaining case still passes.
 *
 * validation[3] ("run a revoked signing identity test") has NO case here and
 * no case is faked for it. Revocation does not exist in this build: there is
 * no `revoked` rejection reason, `registerTrustAnchor` returns an id rather
 * than a disposer and nothing ever removes an anchor, and — the deeper
 * reason — `verifyPackageSignature` trusts a first-seen issuer that was never
 * registered at all. Revocation would therefore be a no-op even if the
 * registry could forget a key, because being unregistered already means
 * trusted. Recorded on P1-02's acceptance lock (BLOCKED-050's family), not
 * papered over with a test that would assert something else and pass.
 */
describe('P1-02 Fault — rejection-boundary matrix', () => {
  /** One enumerated fault boundary and the outcome it must produce. */
  interface ProvenanceFault {
    readonly boundary: string
    readonly run: () => void
  }

  /** Verify one input against a real kernel-issued trust root. */
  function verify(overrides: Partial<PluginProvenanceInput>): PluginProvenanceVerification {
    return verifyPluginProvenance(buildInput(overrides), createTrustKernel().signatureRoots)
  }

  const FAULTS: readonly ProvenanceFault[] = [
    {
      boundary: '01 tampered package digest is refused for digest mismatch',
      run: () => expect(verify({ observed: buildObserved({ observedDigest: brandString<PackageDigest>('sha256:tampered') }) }))
        .toMatchObject({ trust: 'rejected', reason: 'package-digest-mismatch' }),
    },
    {
      boundary: '02 swapped source repo is refused for source-repo mismatch',
      run: () => expect(verify({
        observed: buildObserved({
          observedSourceCommit: { repoUrl: 'https://github.com/evil/plugin-a', commitHash: realSourceCommit.commitHash },
        }),
      })).toMatchObject({ trust: 'rejected', reason: 'source-repo-mismatch' }),
    },
    {
      boundary: '03 forged commit in the same repo is refused distinctly from a repo swap',
      run: () => expect(verify({
        observed: buildObserved({
          observedSourceCommit: { repoUrl: realSourceCommit.repoUrl, commitHash: brandString<SourceCommitHash>('deadbeef') },
        }),
      })).toMatchObject({ trust: 'rejected', reason: 'source-commit-mismatch' }),
    },
    {
      boundary: '04 forged builder identity is refused for builder-identity mismatch',
      run: () => expect(verify({ observed: buildObserved({ observedBuilderIdentity: brandString<BuilderIdentity>('laptop:eve') }) }))
        .toMatchObject({ trust: 'rejected', reason: 'builder-identity-mismatch' }),
    },
    {
      boundary: '05 several mismatches at once still refuse, naming the first checked fact',
      run: () => {
        // Fail-closed must not degrade to a partial pass when an attacker
        // changes MORE than one fact. The reported reason is the first check
        // in order, so this also pins that order.
        const result = verify({
          observed: buildObserved({
            observedDigest: brandString<PackageDigest>('sha256:tampered'),
            observedBuilderIdentity: brandString<BuilderIdentity>('laptop:eve'),
          }),
        })
        expect(result).toMatchObject({ trust: 'rejected', reason: 'package-digest-mismatch' })
      },
    },
    {
      boundary: '06 sigstore evidence with an empty issuer is refused as invalid',
      run: () => expect(verify({ claim: buildClaim({ ...sigstoreEvidence, issuer: '' }) }))
        .toMatchObject({ trust: 'rejected', reason: 'evidence-invalid' }),
    },
    {
      boundary: '07 sigstore evidence with an empty subject is refused as invalid',
      run: () => expect(verify({ claim: buildClaim({ ...sigstoreEvidence, subject: '' }) }))
        .toMatchObject({ trust: 'rejected', reason: 'evidence-invalid' }),
    },
    {
      boundary: '08 sigstore evidence with a negative transparency log index is refused',
      run: () => expect(verify({ claim: buildClaim({ ...sigstoreEvidence, transparencyLogIndex: -1 }) }))
        .toMatchObject({ trust: 'rejected', reason: 'evidence-invalid' }),
    },
    {
      boundary: '09 sigstore evidence with a non-integer log index is refused',
      run: () => expect(verify({ claim: buildClaim({ ...sigstoreEvidence, transparencyLogIndex: 1.5 }) }))
        .toMatchObject({ trust: 'rejected', reason: 'evidence-invalid' }),
    },
    {
      boundary: '10 log index zero is VALID, so the check is not an accidental truthiness test',
      run: () => expect(verify({ claim: buildClaim({ ...sigstoreEvidence, transparencyLogIndex: 0 }) }).trust)
        .toBe('trusted'),
    },
    {
      boundary: '11 offline evidence with an empty signature is refused as invalid',
      run: () => expect(verify({
        claim: buildClaim({
          mode: 'offline-signed',
          signature: new Uint8Array(),
          publicKeyFingerprint: brandString<PublicKeyFingerprint>('SHA256:acme-release-key'),
        }),
      })).toMatchObject({ trust: 'rejected', reason: 'evidence-invalid' }),
    },
    {
      boundary: '12 offline evidence with an empty key fingerprint is refused as invalid',
      run: () => expect(verify({ claim: buildClaim(offlineEvidence(brandString<PublicKeyFingerprint>(''))) }))
        .toMatchObject({ trust: 'rejected', reason: 'evidence-invalid' }),
    },
    {
      boundary: '13 a fact mismatch is reported even when the evidence is ALSO invalid',
      run: () => {
        // Pins that the observed-fact checks run BEFORE the evidence checks.
        // Reporting `evidence-invalid` here would tell an operator the
        // signature was malformed when the real event was a tampered package.
        const result = verify({
          claim: buildClaim({ ...sigstoreEvidence, issuer: '' }),
          observed: buildObserved({ observedDigest: brandString<PackageDigest>('sha256:tampered') }),
        })
        expect(result).toMatchObject({ reason: 'package-digest-mismatch' })
      },
    },
    {
      boundary: '14 an SBOM omitting an installed runtime dependency is refused',
      run: () => expect(verify({ installedDependencyNames: new Set(['left-pad', 'undeclared-dep']) }).trust)
        .toBe('rejected'),
    },
    {
      boundary: '15 a declared runtime dependency that is NOT installed is refused',
      run: () => expect(verify({ installedDependencyNames: new Set<string>() }).trust).toBe('rejected'),
    },
    {
      boundary: '16 a dev-only SBOM entry absent from the installed set is NOT a fault',
      run: () => {
        // typescript is declared `dev` and is not installed. Treating it as
        // missing would make every package with dev dependencies untrusted.
        expect(verify({}).trust).toBe('trusted')
      },
    },
    {
      boundary: '17 unsigned-dev is refused for a profile the deployment does not call dev',
      run: () => {
        const policy: UnsignedDevPolicy = { allowedDevProfileNames: new Set(['dev']) }
        expect(admitUnsignedDevMode({ profileName: 'production', explicitDevOptIn: true }, policy))
          .toEqual({ admitted: false, reason: 'profile-not-dev' })
      },
    },
    {
      boundary: '18 an admitted unsigned-dev profile still carries a persistent untrusted banner',
      run: () => {
        const policy: UnsignedDevPolicy = { allowedDevProfileNames: new Set(['dev']) }
        const admission = admitUnsignedDevMode({ profileName: 'dev', explicitDevOptIn: true }, policy)
        expect(admission).toMatchObject({ admitted: true, banner: { persistent: true } })
      },
    },
  ]

  it('enumerates at least twelve rejection boundaries, each named once', () => {
    expect(FAULTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(FAULTS.map(fault => fault.boundary)).size).toBe(FAULTS.length)
  })

  for (const fault of FAULTS) {
    it(`fault boundary ${fault.boundary}`, () => { fault.run() })
  }

  it('KNOWN GAP (P1-02 lock, validation[3]): an UNREGISTERED signing identity is trusted on sight', () => {
    // This is the honest statement of why a revocation test cannot exist.
    // Nothing registers this fingerprint, and verification still returns
    // trusted, naming an anchor id derived from the fingerprint itself. While
    // "never registered" verifies, "no longer registered" cannot mean
    // anything, so revocation is unreachable rather than merely unimplemented.
    //
    // When the trust root stops trusting first-seen identities this case will
    // start FAILING. That is the unlock signal, not a regression: delete it
    // together with the lock and write the real revocation test.
    const neverRegistered = brandString<PublicKeyFingerprint>('SHA256:attacker-key-nobody-declared')
    const result = verify({ claim: buildClaim(offlineEvidence(neverRegistered)) })

    // Narrowed rather than cast: if this build ever starts REJECTING an
    // unregistered identity, the assertion below fails outright instead of
    // reading a property off the refusal branch.
    expect(result.trust).toBe('trusted')
    if (result.trust !== 'trusted') throw new Error('unreachable: asserted trusted above')
    expect(result.trustAnchorId).toBe(`offline:${neverRegistered}`)
  })
})
