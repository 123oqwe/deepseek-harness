/**
 * P1-02 on the shipped install path (BLOCKED-269): `dsh plugin add` of a local
 * tarball verifies the provenance claim beside it before the package enters the
 * profile, records the verdict in the plugin lock, and refuses a tampered or
 * untrusted claim with its reason.
 *
 * The conventions are the ones the delegate fixed for P1-02's A stroke: the
 * claim travels beside the tarball as `<tgz>.provenance.json`, holding
 * `{ claim, sbom }` with the signature in base64; the trust anchors are the
 * target profile's `package.json` `dsh.trustAnchors`; the verdict is the lock
 * entry's `provenance` field; a refused install writes no lock entry and exits
 * non-zero with the reason on stderr; a package with no claim installs and is
 * recorded unverified (G2).
 *
 * The fixture package carries `repository.url`, `gitHead` and
 * `dsh.provenance.{sourceCommit, builderIdentity}` equal to the genuine claim's,
 * so the positive control holds whether a fix observes those facts from the
 * package or relies on the claim's signature for them. Each variant installs
 * into its own profile under a temporary `$DSH_HOME` through the real
 * `runPlugin`, which runs pnpm.
 */
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import { computeSbomDigest, generateSbom } from '@deepseek-ai/dsh-plugin-provenance'
import {
  computePackageDigest,
  signedClaimBytes,
  type BuilderIdentity,
  type PackageProvenanceClaim,
  type PublicKeyFingerprint,
  type SourceCommitHash,
} from '@deepseek-ai/dsh-plugin-provenance/signature'
import { runPlugin } from '../src/plugin.ts'

const PACKAGE_NAME = 'p1-02-probe-plugin'
const REPO_URL = 'https://github.com/example/p1-02-probe-plugin'
const COMMIT = 'a'.repeat(40)
const BUILDER = 'github-actions:example/p1-02-probe-plugin@main'
const TRUSTED_FINGERPRINT = 'sha256:p1-02-probe-trusted-key'
const UNTRUSTED_FINGERPRINT = 'sha256:p1-02-probe-untrusted-key'

/** The variants each installed into its own profile. */
const VARIANTS = ['genuine', 'no-claim', 'tampered', 'repo-swapped', 'builder-swapped', 'untrusted-key'] as const

/** One variant. */
type Variant = typeof VARIANTS[number]

/** What one install left behind. */
interface Outcome {
  readonly exit: number
  readonly stderr: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly lockEntry: Readonly<Record<string, unknown>> | undefined
}

const trusted = generateKeyPairSync('ed25519')
const untrusted = generateKeyPairSync('ed25519')
const outcomes = new Map<Variant, Outcome>()
let root: string | undefined
let savedHome: string | undefined

/**
 * Write the fixture package and pack it.
 * @param dir - a fresh directory for the package source.
 * @param body - the `index.js` source.
 * @returns the packed tarball's path.
 */
function packFixture(dir: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: PACKAGE_NAME,
    version: '1.0.0',
    main: 'index.js',
    repository: { type: 'git', url: REPO_URL },
    gitHead: COMMIT,
    dsh: { provenance: { sourceCommit: COMMIT, builderIdentity: BUILDER } },
  }, undefined, 2))
  writeFileSync(join(dir, 'index.js'), body)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', dir], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(dir, `${PACKAGE_NAME}-1.0.0.tgz`)
}

/**
 * A claim over a tarball, signed with one key.
 * @param tarball - the tarball the claim describes.
 * @param key - the private key that signs it.
 * @param fingerprint - the fingerprint the evidence names.
 * @returns the signed claim and the SBOM it binds.
 */
function signedClaim(tarball: string, key: KeyObject, fingerprint: string) {
  const packageDigest = computePackageDigest(readFileSync(tarball))
  const sbom = generateSbom('cyclonedx', packageDigest, new Map<string, { readonly version: string; readonly kind: 'runtime' }>())
  const fields = {
    packageDigest,
    sourceCommit: { repoUrl: REPO_URL, commitHash: brandString<SourceCommitHash>(COMMIT) },
    builderIdentity: brandString<BuilderIdentity>(BUILDER),
    sbomDigest: computeSbomDigest(sbom),
  }
  const publicKeyFingerprint = brandString<PublicKeyFingerprint>(fingerprint)
  const unsigned: PackageProvenanceClaim = { ...fields, evidence: { mode: 'offline-signed', signature: new Uint8Array(), publicKeyFingerprint } }
  const claim: PackageProvenanceClaim = {
    ...fields,
    evidence: { mode: 'offline-signed', signature: sign(null, signedClaimBytes(unsigned), key), publicKeyFingerprint },
  }
  return { claim, sbom }
}

/**
 * Write the claim file beside a tarball, as the convention places it.
 * @param tarball - the tarball.
 * @param signed - the claim and SBOM, with any field already swapped.
 * @param signed.claim - the claim.
 * @param signed.sbom - the SBOM.
 */
function writeClaimFile(tarball: string, signed: { claim: PackageProvenanceClaim; sbom: unknown }): void {
  const evidence = signed.claim.evidence
  const encoded = evidence.mode === 'offline-signed' ? { ...evidence, signature: Buffer.from(evidence.signature).toString('base64') } : evidence
  writeFileSync(`${tarball}.provenance.json`, JSON.stringify({ claim: { ...signed.claim, evidence: encoded }, sbom: signed.sbom }, undefined, 2))
}

/**
 * Place a tarball in its own directory, so each variant's claim file sits beside its own copy.
 * @param source - the packed tarball.
 * @param variant - the variant the copy is for.
 * @returns the copy's path.
 */
function copyFor(source: string, variant: Variant): string {
  if (root === undefined) throw new Error('no temporary root')
  const dir = join(root, 'tarballs', variant)
  mkdirSync(dir, { recursive: true })
  const copy = join(dir, `${PACKAGE_NAME}-1.0.0.tgz`)
  writeFileSync(copy, readFileSync(source))
  return copy
}

/**
 * Install one tarball into a fresh profile whose `dsh.trustAnchors` admits the trusted key.
 * @param variant - the variant, which names the profile.
 * @param tarball - the tarball to add.
 * @returns what the install left behind.
 */
async function install(variant: Variant, tarball: string): Promise<Outcome> {
  const profile = `p1-02-${variant}`
  const dir = resolveProfileDir(profile)
  initProfile(dir, [])
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: Record<string, unknown> }
  manifest.dsh = {
    ...manifest.dsh,
    trustAnchors: [{
      mode: 'offline-signed',
      publicKeyFingerprint: TRUSTED_FINGERPRINT,
      owner: 'p1-02 install-path probe',
      publicKeyPem: trusted.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }],
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2))
  const writes: string[] = []
  const capture = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk))
    return true
  })
  let exit = -1
  try {
    exit = await runPlugin(profile, ['add', tarball])
  } finally {
    capture.mockRestore()
  }
  const after = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
  const lockPath = join(dir, 'plugins.lock.json')
  const lock = existsSync(lockPath)
    ? JSON.parse(readFileSync(lockPath, 'utf8')) as { entries?: readonly Record<string, unknown>[] }
    : undefined
  return {
    exit,
    stderr: writes.join(''),
    dependencies: after.dependencies ?? {},
    lockEntry: lock?.entries?.find(entry => entry.name === PACKAGE_NAME),
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'p1-02-install-provenance-'))
  savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, '.dsh')
  const genuine = packFixture(join(root, 'source-genuine'), 'module.exports = "genuine"\n')
  // One byte of the package's own content differs, repacked so the archive stays valid.
  const tampered = packFixture(join(root, 'source-tampered'), 'module.exports = "genuinf"\n')
  const genuineClaim = signedClaim(genuine, trusted.privateKey, TRUSTED_FINGERPRINT)
  const tarballs: Record<Variant, string> = {
    'genuine': copyFor(genuine, 'genuine'),
    'no-claim': copyFor(genuine, 'no-claim'),
    'tampered': copyFor(tampered, 'tampered'),
    'repo-swapped': copyFor(genuine, 'repo-swapped'),
    'builder-swapped': copyFor(genuine, 'builder-swapped'),
    'untrusted-key': copyFor(genuine, 'untrusted-key'),
  }
  writeClaimFile(tarballs['genuine'], genuineClaim)
  writeClaimFile(tarballs['tampered'], genuineClaim)
  writeClaimFile(tarballs['repo-swapped'], {
    claim: { ...genuineClaim.claim, sourceCommit: { ...genuineClaim.claim.sourceCommit, repoUrl: 'https://github.com/attacker/p1-02-probe-plugin' } },
    sbom: genuineClaim.sbom,
  })
  writeClaimFile(tarballs['builder-swapped'], {
    claim: { ...genuineClaim.claim, builderIdentity: brandString<BuilderIdentity>('github-actions:attacker/p1-02-probe-plugin@main') },
    sbom: genuineClaim.sbom,
  })
  writeClaimFile(tarballs['untrusted-key'], signedClaim(genuine, untrusted.privateKey, UNTRUSTED_FINGERPRINT))
  for (const variant of VARIANTS) outcomes.set(variant, await install(variant, tarballs[variant]))
}, 240_000)

afterAll(() => {
  if (savedHome === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
  else process.env.DSH_HOME = savedHome
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

/**
 * Assert one variant was refused with a reason.
 * @param variant - the variant.
 * @param reason - the pattern the stderr reason must match.
 */
function expectRefused(variant: Variant, reason: RegExp): void {
  const outcome = outcomes.get(variant)
  const context = JSON.stringify(outcome)
  expect(outcome?.exit, context).not.toBe(0)
  expect(outcome?.dependencies[PACKAGE_NAME], context).toBeUndefined()
  expect(outcome?.lockEntry, context).toBeUndefined()
  expect(outcome?.stderr, context).toMatch(reason)
}

describe('P1-02 on the shipped install path: dsh plugin add verifies the claim beside a local tarball', () => {
  it('control: a genuine claim under a configured anchor installs the package', () => {
    const outcome = outcomes.get('genuine')
    expect(outcome?.exit, JSON.stringify(outcome)).toBe(0)
    expect(outcome?.dependencies[PACKAGE_NAME], JSON.stringify(outcome)).toBeDefined()
  })

  it('P1-02 acceptance[2]: the genuine install is recorded trusted in the plugin lock, naming its anchor', () => {
    const outcome = outcomes.get('genuine')
    const provenance = outcome?.lockEntry?.provenance as { trust?: unknown; trustAnchorId?: unknown } | undefined
    expect(provenance?.trust, JSON.stringify(outcome)).toBe('trusted')
    expect(typeof provenance?.trustAnchorId === 'string' && provenance.trustAnchorId.length > 0, JSON.stringify(outcome)).toBe(true)
  })

  it('G2: a package with no claim installs and is recorded unverified', () => {
    const outcome = outcomes.get('no-claim')
    const provenance = outcome?.lockEntry?.provenance as { trust?: unknown } | undefined
    expect(outcome?.exit, JSON.stringify(outcome)).toBe(0)
    expect(outcome?.dependencies[PACKAGE_NAME], JSON.stringify(outcome)).toBeDefined()
    expect(provenance?.trust, JSON.stringify(outcome)).toBe('unverified')
  })

  it('P1-02 acceptance[0]: a package changed by one byte after signing is refused as a digest mismatch', () => {
    expectRefused('tampered', /package-digest-mismatch/u)
  })

  it('P1-02 acceptance[0]: a claim whose source repo was replaced is refused', () => {
    expectRefused('repo-swapped', /mismatch|signature-invalid/u)
  })

  it('P1-02 acceptance[0]: a claim whose builder identity was forged is refused', () => {
    expectRefused('builder-swapped', /mismatch|signature-invalid/u)
  })

  it('P1-02 must[2]: a claim signed by a key no configured anchor admits is refused', () => {
    expectRefused('untrusted-key', /trust-anchor-unregistered/u)
  })
})
