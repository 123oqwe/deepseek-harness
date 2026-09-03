/**
 * Provider-stage coverage for the one Epic P1-02 acceptance vector that is
 * real without key material: acceptance[0]'s "篡改一个字节" (a single tampered
 * byte) and, as its direct consequence, acceptance[1]'s "同一锁定包在离线模式
 * 可验证" (the same locked package verifies offline).
 *
 * The Contract stage's own `provenance.spec.ts` proves neither. Its
 * tampered-byte case compares two unrelated fixture strings
 * (`'sha256:9f2c...real-package-tarball'` against
 * `'sha256:9f2c...one-byte-tampered'`) — no package bytes exist anywhere in
 * that file, so the case would pass identically if `verifyPackageSignature`
 * compared any two distinct strings, and nothing about tampering is
 * established. Its offline case passes the identical fixture object to
 * `verifyLockedPackageOffline` that it passes to `verifyPluginProvenance`, so
 * the two agree by construction. Every case below instead builds real bytes,
 * mutates them, and lets the Contract stage's existing rule table
 * (`verifyPackageSignature`) reach the verdict — this file adds no second
 * rule table and changes no decision.
 *
 * **What is NOT proven here, stated once.** `computePackageDigest` binds the
 * artifact to the claim, never the claim to an authority: the final case
 * below executes the attacker who tampers with the bytes AND rewrites the
 * claim's digest to match, and asserts that this still verifies. Closing that
 * needs a signature over the claim against a real trust root, which
 * `createTrustKernel()` does not hold — `signatureRoots` is `Object.freeze({})`
 * (BLOCKED-050). Nothing in this file may be read as evidence for must[0],
 * must[2], must[3], or acceptance[0]'s source-repo and builder-identity
 * vectors, all of which stay BLOCKED.
 *
 * Every case is pure in-memory `node:crypto` over `Uint8Array` values this
 * file constructs: no filesystem, no clock, no network, no temp path, and no
 * platform-dependent behavior, so a pass here is the same signal on every OS.
 */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { describe, expect, it, vi } from 'vitest'
import { verifyLockedPackageOffline, verifyPluginProvenance } from '../src/index.ts'
import type { PluginProvenanceInput } from '../src/index.ts'
import { computePackageDigest } from '../src/signature.ts'
import type {
  BuilderIdentity,
  PackageDigest,
  SigstoreProvenanceEvidence,
  SourceCommitHash,
  SourceCommitReference,
} from '../src/signature.ts'
import type { SbomDigest, SbomDocument } from '../src/sbom.ts'

/** The genuine package artifact's bytes, as an installer would read them off disk. */
const genuinePackageBytes = new Uint8Array([
  0x1f, 0x8b, 0x08, 0x00, 0x64, 0x73, 0x68, 0x2d,
  0x70, 0x6c, 0x75, 0x67, 0x69, 0x6e, 0x2d, 0x61,
  0x00, 0xff, 0x7a, 0x13, 0x42, 0x99, 0xc0, 0x05,
])

/** A copy of `bytes` with the byte at `index` altered by one bit — the "篡改一个字节" attack. */
function flipOneByte(bytes: Uint8Array, index: number): Uint8Array {
  const original = bytes[index]
  if (original === undefined) throw new Error(`test fixture error: no byte at index ${index}`)
  const tampered = Uint8Array.from(bytes)
  tampered[index] = original ^ 0x01
  return tampered
}

const genuineSourceCommit: SourceCommitReference = {
  repoUrl: 'https://github.com/acme/plugin-a',
  commitHash: brandString<SourceCommitHash>('a1b2c3d4e5f6'),
}
const genuineBuilderIdentity = brandString<BuilderIdentity>('github-actions:acme/plugin-a@main')
const sbomDigest = brandString<SbomDigest>('sha256:sbom-of-plugin-a')
const sigstoreEvidence: SigstoreProvenanceEvidence = {
  mode: 'sigstore',
  issuer: 'https://token.actions.githubusercontent.com',
  subject: 'repo:acme/plugin-a:ref:refs/heads/main',
  transparencyLogIndex: 918273,
}
const installedDependencyNames = new Set(['left-pad'])

/** An SBOM for `subjectPackageDigest` whose declared runtime set matches `installedDependencyNames`. */
function sbomFor(subjectPackageDigest: PackageDigest): SbomDocument {
  return {
    format: 'cyclonedx',
    subjectPackageDigest,
    generatedAt: '2026-09-01T00:00:00.000Z',
    entries: [{ name: 'left-pad', version: '1.3.0', kind: 'runtime' }],
  }
}

/**
 * The verification input for a package whose claim was signed over
 * `claimedBytes` and whose installed artifact is `installedBytes` — the two
 * differ exactly when the artifact was tampered with after the claim was
 * fixed. Both digests are recomputed from real bytes; nothing is asserted.
 */
function buildInput(claimedBytes: Uint8Array, installedBytes: Uint8Array): PluginProvenanceInput {
  const claimedDigest = computePackageDigest(claimedBytes)
  return {
    claim: {
      packageDigest: claimedDigest,
      sourceCommit: genuineSourceCommit,
      builderIdentity: genuineBuilderIdentity,
      sbomDigest,
      evidence: sigstoreEvidence,
    },
    observed: {
      observedDigest: computePackageDigest(installedBytes),
      observedSourceCommit: genuineSourceCommit,
      observedBuilderIdentity: genuineBuilderIdentity,
    },
    sbom: sbomFor(claimedDigest),
    installedDependencyNames,
  }
}

describe('P1-02 Provider — computePackageDigest over real bytes', () => {
  it('digests the exact bytes it was given, matching an independently computed sha256 of the same bytes', () => {
    const independent = `sha256:${createHash('sha256').update(genuinePackageBytes).digest('hex')}`
    expect(computePackageDigest(genuinePackageBytes) as string).toBe(independent)
  })

  it('returns the same digest for the same bytes across separate calls, so a verdict does not depend on call order', () => {
    expect(computePackageDigest(genuinePackageBytes)).toBe(computePackageDigest(Uint8Array.from(genuinePackageBytes)))
  })

  it('changes the digest when a single byte of a real package payload is flipped', () => {
    const tampered = flipOneByte(genuinePackageBytes, 9)
    expect(tampered.length).toBe(genuinePackageBytes.length)
    expect(computePackageDigest(tampered)).not.toBe(computePackageDigest(genuinePackageBytes))
  })

  it('changes the digest when two bytes are swapped, so it depends on byte order and not only on content', () => {
    const reordered = Uint8Array.from(genuinePackageBytes)
    const first = reordered[3]
    const second = reordered[4]
    if (first === undefined || second === undefined) throw new Error('test fixture error: payload is shorter than the swapped indices')
    expect(first).not.toBe(second)
    reordered[3] = second
    reordered[4] = first
    expect(computePackageDigest(reordered)).not.toBe(computePackageDigest(genuinePackageBytes))
  })

  it('changes the digest when one byte is appended, so it depends on length and not only on the leading bytes', () => {
    const extended = new Uint8Array(genuinePackageBytes.length + 1)
    extended.set(genuinePackageBytes)
    expect(computePackageDigest(extended)).not.toBe(computePackageDigest(genuinePackageBytes))
  })
})

describe('P1-02 Provider — acceptance[0]: 篡改一个字节 rejected against real bytes', () => {
  it('verifies the untampered package, so the rejections below are caused by the tampering and not by the fixture', () => {
    const kernel = createTrustKernel()
    const result = verifyPluginProvenance(buildInput(genuinePackageBytes, genuinePackageBytes), kernel.signatureRoots)
    expect(result.trust).toBe('trusted')
  })

  it('rejects a package whose installed bytes differ from the claimed ones by a single flipped byte', () => {
    const kernel = createTrustKernel()
    const input = buildInput(genuinePackageBytes, flipOneByte(genuinePackageBytes, 9))
    const result = verifyPluginProvenance(input, kernel.signatureRoots)
    expect(result.trust).toBe('rejected')
    if (result.trust === 'rejected') expect(result.reason).toBe('package-digest-mismatch')
  })

  it('rejects a tampered byte at the very first and very last positions alike, leaving no unchecked region of the artifact', () => {
    const kernel = createTrustKernel()
    for (const index of [0, genuinePackageBytes.length - 1]) {
      const input = buildInput(genuinePackageBytes, flipOneByte(genuinePackageBytes, index))
      const result = verifyPluginProvenance(input, kernel.signatureRoots)
      expect(result.trust).toBe('rejected')
      if (result.trust === 'rejected') expect(result.reason).toBe('package-digest-mismatch')
    }
  })
})

describe('P1-02 Provider — acceptance[1]: the same locked package verifies offline', () => {
  it('reaches the identical trusted verdict for the same locked bytes through a separately loaded module instance', async () => {
    const online = verifyPluginProvenance(buildInput(genuinePackageBytes, genuinePackageBytes), createTrustKernel().signatureRoots)
    vi.resetModules()
    const offlineModule = await import('../src/index.ts')
    const offlineSignature = await import('../src/signature.ts')
    const offlineKernel = (await import('@deepseek-ai/dsh-trust-kernel')).createTrustKernel()
    const claimedDigest = offlineSignature.computePackageDigest(genuinePackageBytes)
    const locked: PluginProvenanceInput = {
      claim: {
        packageDigest: claimedDigest,
        sourceCommit: genuineSourceCommit,
        builderIdentity: genuineBuilderIdentity,
        sbomDigest,
        evidence: sigstoreEvidence,
      },
      observed: {
        observedDigest: offlineSignature.computePackageDigest(genuinePackageBytes),
        observedSourceCommit: genuineSourceCommit,
        observedBuilderIdentity: genuineBuilderIdentity,
      },
      sbom: sbomFor(claimedDigest),
      installedDependencyNames,
    }
    const offline = offlineModule.verifyLockedPackageOffline(locked, offlineKernel.signatureRoots)
    expect(offline.trust).toBe('trusted')
    expect(offline.trust).toBe(online.trust)
    expect(claimedDigest).toBe(computePackageDigest(genuinePackageBytes))
  })

  it('rejects the same one-byte tampering offline that it rejects online, so the offline path is not the weaker one', () => {
    const kernel = createTrustKernel()
    const input = buildInput(genuinePackageBytes, flipOneByte(genuinePackageBytes, 9))
    const offline = verifyLockedPackageOffline(input, kernel.signatureRoots)
    const online = verifyPluginProvenance(input, kernel.signatureRoots)
    expect(offline).toStrictEqual(online)
    expect(offline.trust).toBe('rejected')
    if (offline.trust === 'rejected') expect(offline.reason).toBe('package-digest-mismatch')
  })
})

describe('P1-02 Provider — the limit of a digest without a trust root (BLOCKED-050)', () => {
  it('KNOWN GAP (BLOCKED-050 hollow signature root): a tamper-and-rewrite attacker still verifies -- asserts CURRENT behavior, NOT desired behavior; giving the kernel real key material MUST break this test', () => {
    const kernel = createTrustKernel()
    const tampered = flipOneByte(genuinePackageBytes, 9)
    // The attacker controls the claim as well as the artifact, so both
    // digests are recomputed from the tampered bytes and agree. A digest
    // binds an artifact to a claim; only a signature over the claim, against
    // a root holding real key material, binds the claim to an authority.
    // When `createTrustKernel()` stops minting `signatureRoots` as
    // `Object.freeze({})`, this expectation is meant to fail: that failure is
    // Epic P1-02's unlock signal, never a regression to restore to green.
    const result = verifyPluginProvenance(buildInput(tampered, tampered), kernel.signatureRoots)
    expect(result.trust).toBe('trusted')
  })
})
