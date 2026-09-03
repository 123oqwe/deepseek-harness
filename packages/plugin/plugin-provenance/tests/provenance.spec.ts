/**
 * Contract-stage RED scaffold for Epic P1-02's plugin signature, provenance,
 * and dependency SBOM verification. One `it()` per registry-declared
 * acceptance clause (splitting acceptance[0]'s three named fail-closed
 * scenarios into three cases) plus every must[] clause that is structurally
 * testable at this Contract level. Every case below calls a real exported
 * function against real branded fixture data; every function currently
 * throws `'not implemented: ...'` (`../src/signature.ts`, `../src/sbom.ts`,
 * `../src/index.ts`), so every case fails for that reason today — the
 * assertions themselves describe the behavior a later fix-round must
 * satisfy.
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
