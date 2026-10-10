/**
 * P1-04 (A) sub-slice 1: the plugin installer's quarantine/extract/verify logic.
 *
 * The ctx-free exported functions carry the security decisions, so they are
 * exercised directly against real tarballs and a real trust kernel:
 * `verifyPackage` against a genuinely-signed offline package (and a tampered /
 * unregistered one), and `safeExtract` against malicious archives. The service
 * `install()` is then exercised in a real cordis composition — the installer
 * mounted with `ctx.plugin` and the trust kernel pinned — to prove the
 * orchestration (verify before extract) end to end.
 *
 * Harness note: this is a package-level composition (`ctx.plugin` + pinned
 * kernel, as attachment-security tests its scanner), not a Loader-boot smoke —
 * plugin-installer is not mounted in any profile or resolver manifest in
 * sub-slice 1 (no factory consumer; the CLI is still a thin forwarder). The
 * Loader-boot composition attaches at sub-slice 2, when the CLI mounts it.
 * @module tests/installer
 */

import { generateKeyPairSync, sign as signBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { computePackageDigest, computeSbomDigest, registerTrustAnchor } from '@deepseek-ai/dsh-plugin-provenance'
import { signedClaimBytes } from '@deepseek-ai/dsh-plugin-provenance/signature'
import type {
  BuilderIdentity,
  OfflineSignedProvenanceEvidence,
  PackageProvenanceClaim,
  PublicKeyFingerprint,
  SbomDocument,
  SourceCommitHash,
  SourceCommitReference,
} from '@deepseek-ai/dsh-plugin-provenance'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { create as tarCreate } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import LocalPluginInstaller, { createQuarantine, safeExtract, verifyPackage } from '../src/index.ts'
import { PluginInstallError } from '../src/errors.ts'
import type { ExtractionPolicy, ProvenanceAssertion } from '../src/types.ts'

// One ephemeral Ed25519 key per test process; only the public half is registered.
const signingKeys = generateKeyPairSync('ed25519')
const offlinePublicKeyPem = signingKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const offlineFingerprint = brandString<PublicKeyFingerprint>('sha256:test-offline-key')
const sourceCommit: SourceCommitReference = {
  repoUrl: 'https://github.com/acme/plugin-x',
  commitHash: brandString<SourceCommitHash>('a1b2c3d4e5f6'),
}
const builderIdentity = brandString<BuilderIdentity>('github-actions:acme/plugin-x@main')
const installedDependencyNames = new Set(['left-pad'])
const policy: ExtractionPolicy = { maxDecompressionRatio: 100, maxUncompressedBytes: 512 * 1024 * 1024 }

const tempRoots: string[] = []
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A disposable staging/output directory tracked for cleanup. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

/** Build a gzipped tar from entries staged by `stage`, returning its bytes. */
function makeTgz(stage: (dir: string) => string[], cwdOf: (dir: string) => string = dir => dir): Uint8Array {
  const dir = tempDir('dsh-pi-stage-')
  const paths = stage(dir)
  // tar 7.x's `create` refuses an empty path list, so build the empty archive directly:
  // two all-zero 512-byte records are a tar end-of-archive marker carrying no entries.
  if (paths.length === 0) return gzipSync(Buffer.alloc(1024))
  const tgz = join(tempDir('dsh-pi-tgz-'), 'pkg.tgz')
  tarCreate({ file: tgz, cwd: cwdOf(dir), gzip: true, preservePaths: true, sync: true, follow: false }, paths)
  return readFileSync(tgz)
}

/** The offline evidence signing one claim's facts (the signature never covers itself). */
function signOffline(facts: Omit<PackageProvenanceClaim, 'evidence'>): OfflineSignedProvenanceEvidence {
  const placeholder: OfflineSignedProvenanceEvidence = { mode: 'offline-signed', signature: new Uint8Array(), publicKeyFingerprint: offlineFingerprint }
  const forSigning: PackageProvenanceClaim = { ...facts, evidence: placeholder }
  return {
    mode: 'offline-signed',
    signature: signBytes(null, signedClaimBytes(forSigning), signingKeys.privateKey),
    publicKeyFingerprint: offlineFingerprint,
  }
}

/** A genuine signed provenance assertion for exactly `tarball`'s bytes. */
function assertionFor(tarball: Uint8Array): ProvenanceAssertion {
  const packageDigest = computePackageDigest(tarball)
  const sbom: SbomDocument = {
    format: 'cyclonedx',
    subjectPackageDigest: packageDigest,
    generatedAt: '2026-10-10T00:00:00.000Z',
    entries: [{ name: 'left-pad', version: '1.0.0', kind: 'runtime' }],
  }
  const facts = { packageDigest, sourceCommit, builderIdentity, sbomDigest: computeSbomDigest(sbom) }
  return {
    claim: { ...facts, evidence: signOffline(facts) },
    sbom,
    installedDependencyNames,
    observedSourceCommit: sourceCommit,
    observedBuilderIdentity: builderIdentity,
  }
}

/** A trust kernel that has admitted the fixtures' offline key. */
function kernelWithAnchor(): ReturnType<typeof createTrustKernel> {
  const kernel = createTrustKernel()
  registerTrustAnchor(kernel.signatureRoots, {
    mode: 'offline-signed',
    publicKeyFingerprint: offlineFingerprint,
    owner: 'plugin-installer test',
    publicKeyPem: offlinePublicKeyPem,
  })
  return kernel
}

const benignTgz = (): Uint8Array => makeTgz((dir) => {
  writeFileSync(join(dir, 'index.js'), 'export const plugin = 1\n')
  return ['index.js']
})

describe('verifyPackage (P1-02 provenance over the tarball bytes)', () => {
  it('a genuinely-signed package verifies and returns its trust anchor', () => {
    const tarball = benignTgz()
    const anchorId = verifyPackage(tarball, assertionFor(tarball), kernelWithAnchor().signatureRoots)
    expect(typeof anchorId).toBe('string')
  })

  it('a tampered byte (observed digest no longer matches the claim) is refused', () => {
    const tarball = benignTgz()
    const assertion = assertionFor(tarball) // claim fixed over `tarball`
    const tampered = benignTgz()
    tampered[0] ^= 0xff // benignTgz() is deterministic, so perturb a byte: the observed digest must differ from the claim's
    expect(() => verifyPackage(tampered, assertion, kernelWithAnchor().signatureRoots))
      .toThrow(PluginInstallError)
  })

  it('a package signed by an unregistered key is refused', () => {
    const tarball = benignTgz()
    expect(() => verifyPackage(tarball, assertionFor(tarball), createTrustKernel().signatureRoots))
      .toThrow(PluginInstallError)
  })
})

describe('safeExtract (acceptance[0]/[1]: unpack only, refuse malicious archives)', () => {
  const extractInto = (tarball: Uint8Array, p: ExtractionPolicy = policy): Promise<void> => {
    const q = createQuarantine(tempDir('dsh-pi-q-'))
    return safeExtract(tarball, q.root, q.extractDir, p)
  }

  it('a benign package extracts its files', async () => {
    const q = createQuarantine(tempDir('dsh-pi-q-'))
    await safeExtract(benignTgz(), q.root, q.extractDir, policy)
    expect(readdirSync(q.extractDir)).toContain('index.js')
  })

  it('refuses a symbolic-link entry', async () => {
    const tarball = makeTgz((dir) => {
      symlinkSync('/etc/passwd', join(dir, 'link'))
      return ['link']
    })
    await expect(extractInto(tarball)).rejects.toMatchObject({ code: 'symlink-entry' })
  })

  it('refuses a path-traversal entry', async () => {
    const tarball = makeTgz((dir) => {
      const sub = join(dir, 'sub')
      mkdirSync(sub)
      writeFileSync(join(dir, 'evil.js'), 'escaped\n')
      return ['../evil.js']
    }, dir => join(dir, 'sub'))
    await expect(extractInto(tarball)).rejects.toMatchObject({ code: 'path-traversal' })
  })

  it('refuses a decompression bomb (over the uncompressed-byte cap)', async () => {
    const tarball = makeTgz((dir) => {
      writeFileSync(join(dir, 'big.js'), 'x'.repeat(4096))
      return ['big.js']
    })
    await expect(extractInto(tarball, { maxDecompressionRatio: 100, maxUncompressedBytes: 256 }))
      .rejects.toMatchObject({ code: 'decompression-bomb' })
  })

  it('refuses an empty archive', async () => {
    const tarball = makeTgz(() => [])
    await expect(extractInto(tarball)).rejects.toMatchObject({ code: 'empty-archive' })
  })
})

describe('install() in a real composition (verify before extract)', () => {
  const mount = async (): Promise<Context> => {
    const ctx = new Context()
    pinTrustKernel(ctx, kernelWithAnchor())
    await ctx.plugin(LocalPluginInstaller, {})
    return ctx
  }

  it('a benign signed package is verified and extracted', async () => {
    const ctx = await mount()
    const tarball = benignTgz()
    const installed = await ctx.pluginInstaller.install({ tarball, provenance: assertionFor(tarball) })
    expect(readdirSync(installed.extractedPath)).toContain('index.js')
    await ctx.fiber.dispose()
  })

  it('a signed-but-malicious package passes verify and is then refused at extract', async () => {
    const ctx = await mount()
    const tarball = makeTgz((dir) => {
      symlinkSync('/etc/passwd', join(dir, 'link'))
      return ['link']
    })
    await expect(ctx.pluginInstaller.install({ tarball, provenance: assertionFor(tarball) }))
      .rejects.toMatchObject({ code: 'symlink-entry' })
    await ctx.fiber.dispose()
  })
})
