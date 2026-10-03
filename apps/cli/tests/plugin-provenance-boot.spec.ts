/**
 * P1-02 on the SHIPPED startup path (A-573): after `dsh plugin add` records a
 * local tarball's provenance in the plugin lock, the next boot re-verifies that
 * locked package offline and refuses to start when the verdict no longer holds
 * — a revoked signing anchor (acceptance[1]), a missing declaration
 * (acceptance[1]/[2]), or a tarball whose bytes no longer match the lock's
 * recorded digest (acceptance[1], blind 2-1(a)) — rather than carrying a stale
 * `trusted` verdict into the running harness.
 *
 * Red first for B-686. §21.4: the fix is not read. Each case installs a genuine
 * claim through the real `runPlugin` (A-436's path), so the lock records
 * `trusted`, then manipulates one thing and boots the same profile in-process
 * through `runProfile` under enforcement (the in-process-launch precedent). The
 * observable is PRODUCT STATE: `runProfile` rejects (the boot is refused) — and,
 * where relevant, the stderr reason. Today no startup re-verification exists, so
 * every manipulated boot still SUCCEEDS; the refusal assertions fail (RED).
 *
 * The CONTROL is the harness guard the delegate required: a clean,
 * install-time-trusted package boots normally (green today AND after the fix).
 * If the harness itself cannot boot such a profile, the CONTROL goes red —
 * never a manipulated case passing its refusal assertion for the wrong reason.
 */

import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initProfile, loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
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
import type { PluginPermissionState } from '@deepseek-ai/dsh-host-plugin-inventory'
import { runPlugin } from '../src/plugin.ts'
import { runProfile } from '../src/profile-boot.ts'

// A read-only audit sink injected into every kernel the boot mints: it captures
// the entries `auditAppend` is called with and changes no behavior (the default
// sink is a no-op), so it is safe for the cases that do not assert on it. This
// is how case 8 observes acceptance[2]'s audit records on the factory boot path
// without reading the fix (B-686).
const auditEntries = vi.hoisted(() => [] as unknown[])
vi.mock('@deepseek-ai/dsh-trust-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-trust-kernel')>()
  return {
    ...actual,
    createTrustKernel: (config: Parameters<typeof actual.createTrustKernel>[0] = {}) =>
      actual.createTrustKernel({ ...config, auditSink: (entry) => { auditEntries.push(entry) } }),
  }
})

// A read-only wrapper over the inventory's post-mount permission-state builder:
// it captures the states the boot computes and returns them unchanged, so the
// inventory case can read the per-entry provenance verdict without an output
// outlet the product does not ship (§19) and without changing behavior.
const inventoryStates = vi.hoisted(() => [] as PluginPermissionState[])
vi.mock('@deepseek-ai/dsh-host-plugin-inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-host-plugin-inventory')>()
  return {
    ...actual,
    buildPluginPermissionStates: (...args: Parameters<typeof actual.buildPluginPermissionStates>): PluginPermissionState[] => {
      const states = actual.buildPluginPermissionStates(...args)
      inventoryStates.push(...states)
      return states
    },
  }
})

const PACKAGE_NAME = 'p1-02-boot-probe-plugin'
const REPO_URL = 'https://github.com/example/p1-02-boot-probe-plugin'
const COMMIT = 'b'.repeat(40)
const BUILDER = 'github-actions:example/p1-02-boot-probe-plugin@main'
const TRUSTED_FINGERPRINT = 'sha256:p1-02-boot-trusted-key'
const ENFORCEMENT_ENV = 'DSH_PLUGIN_MANIFEST_ENFORCEMENT'
const RESTORED_ENV = ['DSH_HOME', 'DSH_TRUST_KERNEL_INSECURE', ENFORCEMENT_ENV] as const
const OBSERVED_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'] as const
/** Deadline for one install-and-boot case (the install runs pnpm). */
const CASE_TIMEOUT_MS = 180_000

const trusted = generateKeyPairSync('ed25519')
const emitter: NodeJS.EventEmitter = process
const roots: string[] = []
let savedEnv = new Map<string, string | undefined>()
let savedListeners = new Map<string, readonly unknown[]>()

beforeEach(() => {
  auditEntries.length = 0
  inventoryStates.length = 0
  savedEnv = new Map(RESTORED_ENV.map((name): [string, string | undefined] => [name, process.env[name]]))
  savedListeners = new Map(OBSERVED_EVENTS.map((event): [string, readonly unknown[]] => [event, emitter.listeners(event)]))
})

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
  for (const [event, before] of savedListeners) {
    for (const listener of emitter.listeners(event)) {
      if (!before.includes(listener)) emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Pack a fixture package and return its tarball path.
 * @param dir - a fresh source directory.
 * @param body - the package's `index.js` body (its bytes, so a different body is a different digest).
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
 * A genuine claim over a tarball, signed with the trusted key.
 * @param tarball - the tarball the claim describes.
 * @returns the signed claim and the SBOM it binds.
 */
function signedClaim(tarball: string): { claim: PackageProvenanceClaim; sbom: unknown } {
  const packageDigest = computePackageDigest(readFileSync(tarball))
  const sbom = generateSbom('cyclonedx', packageDigest, new Map<string, { readonly version: string; readonly kind: 'runtime' }>())
  const fields = {
    packageDigest,
    sourceCommit: { repoUrl: REPO_URL, commitHash: brandString<SourceCommitHash>(COMMIT) },
    builderIdentity: brandString<BuilderIdentity>(BUILDER),
    sbomDigest: computeSbomDigest(sbom),
  }
  const publicKeyFingerprint = brandString<PublicKeyFingerprint>(TRUSTED_FINGERPRINT)
  const unsigned: PackageProvenanceClaim = { ...fields, evidence: { mode: 'offline-signed', signature: new Uint8Array(), publicKeyFingerprint } }
  const claim: PackageProvenanceClaim = {
    ...fields,
    evidence: { mode: 'offline-signed', signature: sign(null, signedClaimBytes(unsigned), trusted.privateKey), publicKeyFingerprint },
  }
  return { claim, sbom }
}

/** Write the claim file beside its tarball, as the install convention places it. */
function writeClaimFile(tarball: string, signed: { claim: PackageProvenanceClaim; sbom: unknown }): void {
  const evidence = signed.claim.evidence
  const encoded = evidence.mode === 'offline-signed' ? { ...evidence, signature: Buffer.from(evidence.signature).toString('base64') } : evidence
  writeFileSync(`${tarball}.provenance.json`, JSON.stringify({ claim: { ...signed.claim, evidence: encoded }, sbom: signed.sbom }, undefined, 2))
}

/** The trust anchor that admits the trusted key, as the profile's `dsh.trustAnchors` records it. */
function trustedAnchor(): Record<string, unknown> {
  return {
    mode: 'offline-signed',
    publicKeyFingerprint: TRUSTED_FINGERPRINT,
    owner: 'p1-02 boot-path probe',
    publicKeyPem: trusted.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** One installed profile: where it lives and the tarball it was installed from. */
interface Installed {
  readonly profile: string
  readonly dir: string
  readonly tarball: string
}

/**
 * Install one scenario's genuine claim through the real `runPlugin`, so the
 * lock records `trusted`.
 * @param scenario - names the profile and its temp root.
 * @param body - the fixture package's body.
 * @returns the installed profile, or throws when the install did not record it trusted.
 */
async function installTrusted(scenario: string, body: string): Promise<Installed> {
  const root = mkdtempSync(join(tmpdir(), `p1-02-boot-${scenario}-`))
  roots.push(root)
  process.env.DSH_HOME = join(root, '.dsh')
  const source = packFixture(join(root, 'source'), body)
  const tarball = join(root, `${PACKAGE_NAME}-1.0.0.tgz`)
  writeFileSync(tarball, readFileSync(source))
  writeClaimFile(tarball, signedClaim(tarball))
  const profile = `p1-02-boot-${scenario}`
  const dir = resolveProfileDir(profile)
  initProfile(dir, [])
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: Record<string, unknown> }
  manifest.dsh = { ...manifest.dsh, trustAnchors: [trustedAnchor()] }
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2))
  const exit = await runPlugin(profile, ['add', tarball])
  if (exit !== 0) throw new Error(`install for ${scenario} did not succeed (exit ${exit})`)
  const lock = JSON.parse(readFileSync(join(dir, 'plugins.lock.json'), 'utf8')) as { entries?: readonly { name?: string; provenance?: { trust?: unknown } }[] }
  const recorded = lock.entries?.find(entry => entry.name === PACKAGE_NAME)?.provenance?.trust
  if (recorded !== 'trusted') throw new Error(`install for ${scenario} recorded ${JSON.stringify(recorded)}, not trusted`)
  return { profile, dir, tarball }
}

/**
 * Pack a MOUNTABLE fixture: a cordis plugin with a no-op `apply` and a truthful
 * v2 manifest (declaring no tools, so admission enforcement admits it), plus the
 * `dsh.provenance` facts a claim is checked against.
 * @param dir - a fresh source directory.
 * @returns the packed tarball's path.
 */
function packMountable(dir: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: PACKAGE_NAME,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    repository: { type: 'git', url: REPO_URL },
    gitHead: COMMIT,
    dsh: {
      provenance: { sourceCommit: COMMIT, builderIdentity: BUILDER },
      manifestVersion: 2,
      tools: [],
      executionMode: 'in-process',
      compatibility: { dshVersionRange: '*' },
    },
  }, undefined, 2))
  writeFileSync(join(dir, 'index.mjs'), 'export const name = \'p1-02-boot-probe-plugin\'\nexport function apply() {}\n')
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', dir], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(dir, `${PACKAGE_NAME}-1.0.0.tgz`)
}

/** One installed-and-mountable profile, plus what the install wrote and how to mount it. */
interface Mounted {
  readonly profile: string
  readonly dir: string
  readonly installStderr: string
  readonly mountOverlay: string
}

/**
 * Install a mountable plugin through the real `runPlugin`, then write a `--patch`
 * overlay that mounts it — the ops way to add then mount a plugin.
 * @param scenario - names the profile and temp root.
 * @param withClaim - whether to place a genuine claim (records trusted) or none (records unverified, G2).
 * @returns the profile, the install's stderr, and the mount overlay.
 */
async function installAndMount(scenario: string, withClaim: boolean): Promise<Mounted> {
  const root = mkdtempSync(join(tmpdir(), `p1-02-boot-${scenario}-`))
  roots.push(root)
  process.env.DSH_HOME = join(root, '.dsh')
  const source = packMountable(join(root, 'source'))
  const tarball = join(root, `${PACKAGE_NAME}-1.0.0.tgz`)
  writeFileSync(tarball, readFileSync(source))
  if (withClaim) writeClaimFile(tarball, signedClaim(tarball))
  const profile = `p1-02-boot-${scenario}`
  const dir = resolveProfileDir(profile)
  initProfile(dir, [])
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: Record<string, unknown> }
  manifest.dsh = { ...manifest.dsh, trustAnchors: [trustedAnchor()] }
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2))
  const installWrites: string[] = []
  const capture = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    installWrites.push(String(chunk))
    return true
  })
  let exit = -1
  try {
    exit = await runPlugin(profile, ['add', tarball])
  } finally {
    capture.mockRestore()
  }
  if (exit !== 0) throw new Error(`install for ${scenario} did not succeed (exit ${exit})`)
  const mountOverlay = join(root, 'mount.patch.yml')
  writeFileSync(mountOverlay, `- insert:\n    - id: ${PACKAGE_NAME}-mount\n      name: ${PACKAGE_NAME}\n`)
  return { profile, dir, installStderr: installWrites.join(''), mountOverlay }
}

/** Whether a captured stderr has a line that names the plugin and flags it untrusted/unverified. */
function warnsUntrusted(stderr: string): boolean {
  return stderr.split('\n').some(line =>
    line.includes(PACKAGE_NAME) && /unverified|untrusted|not verified|no verified provenance/iu.test(line))
}

/** What one boot left. */
interface BootResult {
  readonly error: unknown
  readonly stderr: string
}

/**
 * Boot an already-installed profile in-process under enforcement, capturing its
 * rejection and stderr.
 * @param profile - the profile to boot.
 * @param patchFiles - `--patch` overlays, e.g. one that mounts the installed plugin.
 * @returns the boot's error (undefined when it resolved) and captured stderr.
 */
async function bootInstalled(profile: string, patchFiles: readonly string[] = []): Promise<BootResult> {
  process.env[ENFORCEMENT_ENV] = 'enforce'
  delete process.env.DSH_TRUST_KERNEL_INSECURE
  const writes: string[] = []
  const capture = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk))
    return true
  })
  const cwd = mkdtempSync(join(tmpdir(), 'p1-02-boot-cwd-'))
  roots.push(cwd)
  try {
    const error = await runProfile({
      environment: loadLayeredEnv('dsh', cwd),
      profile,
      fromDefaultProfile: undefined,
      patchFiles,
      args: [],
    }).then(
      async ({ ctx }) => { await ctx.fiber.dispose(); return undefined },
      (rejection: unknown) => rejection,
    )
    return { error, stderr: writes.join('') }
  } finally {
    capture.mockRestore()
  }
}

describe('P1-02 on the shipped startup path: the next boot re-verifies the locked package and refuses a stale verdict (red first for B-686)', () => {
  it('control: a clean, install-time-trusted package boots normally', async () => {
    const installed = await installTrusted('control', 'module.exports = "genuine"\n')
    const result = await bootInstalled(installed.profile)
    // Green today AND after the fix. If this fails, the harness cannot boot such
    // a profile — the manipulated cases below would be red for that reason, not
    // for the missing re-verification, so this guards them.
    expect(result.error, JSON.stringify(result)).toBeUndefined()
  }, CASE_TIMEOUT_MS)

  it('acceptance[1]/[2]: a locked trusted package whose declaration file is gone at boot refuses to start, not silently carried as trusted', async () => {
    const installed = await installTrusted('missing-claim', 'module.exports = "genuine"\n')
    rmSync(`${installed.tarball}.provenance.json`)
    const result = await bootInstalled(installed.profile)
    // Today no startup re-verification runs, so the boot still succeeds (error
    // undefined) although the declaration that justified the lock's `trusted`
    // verdict is gone. B-686 refuses, naming the missing file.
    expect(result.error, JSON.stringify(result)).toBeInstanceOf(Error)
  }, CASE_TIMEOUT_MS)

  it('acceptance[1]: a locked trusted package whose signing anchor was removed refuses to start when re-verified offline (revoked signing identity)', async () => {
    const installed = await installTrusted('revoked-anchor', 'module.exports = "genuine"\n')
    // Remove the anchor that signed the claim. The tarball, declaration and the
    // lock's recorded digest are all untouched and still agree, so only the
    // offline re-verification — the claim's key no longer admitted — can catch it.
    const manifestPath = join(installed.dir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: Record<string, unknown> }
    manifest.dsh = { ...manifest.dsh, trustAnchors: [] }
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2))
    const result = await bootInstalled(installed.profile)
    expect(result.error, JSON.stringify(result)).toBeInstanceOf(Error)
  }, CASE_TIMEOUT_MS)

  it('acceptance[1] (blind 2-1(a)): a locked package whose tarball bytes no longer match the lock\'s recorded digest refuses to start, even when its re-signed claim verifies', async () => {
    const installed = await installTrusted('lock-digest', 'module.exports = "genuine"\n')
    // Swap the tarball for different bytes and re-sign the new bytes with the
    // same registered key, so offline re-verification of the claim alone would
    // pass. Only the lock-digest check — the tarball's bytes vs the
    // `packageDigest` the lock recorded at install — catches the substitution.
    const swapRoot = mkdtempSync(join(tmpdir(), 'p1-02-boot-swap-'))
    roots.push(swapRoot)
    const swapped = packFixture(join(swapRoot, 'source'), 'module.exports = "swapped-after-lock"\n')
    writeFileSync(installed.tarball, readFileSync(swapped))
    writeClaimFile(installed.tarball, signedClaim(installed.tarball))
    const result = await bootInstalled(installed.profile)
    expect(result.error, JSON.stringify(result)).toBeInstanceOf(Error)
  }, CASE_TIMEOUT_MS)

  it('acceptance[2]: the startup verification of a locked package appends a key-free plugin-provenance audit record', async () => {
    const installed = await installTrusted('audit', 'module.exports = "genuine"\n')
    await bootInstalled(installed.profile)
    // The kernel audit payload is { kind: 'plugin-provenance', stage, name, … }
    // (install writes stage 'install', the boot verdict stage 'boot'). This case
    // is the BOOT append, so it must recognise only the stage 'boot' record for
    // this package: counting the install path's stage 'install' record would let
    // the boot append be removed with the case still green. Today nothing on the
    // boot path appends one — RED. B-686 appends the boot verdict; the record is
    // key-free by type (ProvenanceAuditRecord).
    const sawBootProvenanceAudit = auditEntries.some((entry) => {
      const payload = (entry as { readonly payload?: unknown }).payload
      if (typeof payload !== 'object' || payload === null) return false
      const record = payload as { readonly kind?: unknown; readonly stage?: unknown; readonly name?: unknown }
      return record.kind === 'plugin-provenance' && record.stage === 'boot' && record.name === PACKAGE_NAME
    })
    expect(sawBootProvenanceAudit, JSON.stringify(auditEntries)).toBe(true)
  }, CASE_TIMEOUT_MS)

  it('acceptance[2]: the boot inventory records a mounted plugin\'s locked trusted verdict and its anchor, not unverified', async () => {
    const installed = await installAndMount('inventory-trusted', true)
    const result = await bootInstalled(installed.profile, [installed.mountOverlay])
    // Guard: the plugin actually mounted, so the enforcement pass built a state
    // for it (a broken mount shows here, not as a false pass of the verdict).
    const own = inventoryStates.filter(state => state.packageIdentity.name === PACKAGE_NAME)
    expect(own.length, JSON.stringify({ error: result.error, states: inventoryStates })).toBeGreaterThan(0)
    // acceptance[2]: its inventory record carries the install-time trusted verdict
    // and its anchor. Today every entry is recorded no-provenance-claim whatever
    // the lock says, so none is trusted — RED. B-686 carries the lock's record in.
    expect(
      own.some(state => state.provenanceAudit.trust === 'trusted' && typeof state.provenanceAudit.trustAnchorId === 'string'),
      JSON.stringify(own),
    ).toBe(true)
  }, CASE_TIMEOUT_MS)

  it('must[4]/G4 (Q30(b)): an unverified mounted plugin draws a persistent untrusted warning naming it — at install and on each of two boots, in a non-development profile', async () => {
    const installed = await installAndMount('unverified-warn', false)
    const first = await bootInstalled(installed.profile, [installed.mountOverlay])
    const second = await bootInstalled(installed.profile, [installed.mountOverlay])
    // G2: an unverified plugin still installs and loads — both boots succeed.
    expect(first.error, JSON.stringify(first)).toBeUndefined()
    expect(second.error, JSON.stringify(second)).toBeUndefined()
    // Q30(b): the untrusted state is shown in EVERY profile (this one is not a
    // development profile), at install and persistently on each boot. Today no
    // such warning is written anywhere — RED on all three.
    expect(warnsUntrusted(installed.installStderr), installed.installStderr).toBe(true)
    expect(warnsUntrusted(first.stderr), first.stderr).toBe(true)
    expect(warnsUntrusted(second.stderr), second.stderr).toBe(true)
  }, CASE_TIMEOUT_MS)
})
