/**
 * P4-09 acceptance[0], question 31 (a): a saved workflow definition is run by a
 * shipped profile only when it is signed by a key the profile's
 * `dsh.trustAnchors` admits, and a definition whose body was changed, whose
 * signature is missing, whose key is not anchored, or whose signature does not
 * verify is NOT run — it is refused, and the refusal names the reason.
 *
 * Red first, paired with B-698's fourth commit (which mounts the saved-workflow
 * loader into the factory base layer and verifies each definition's signature).
 * §21.4: B-698 is not read. Today the shipped base mounts no saved-workflow
 * loader at all, so a factory boot exposes no `ctx.savedWorkflows` and every
 * assertion below fails; the shipped loader (workflow-filesystem) also verifies
 * no signature. B-698 mounts it and verifies, so the valid definition loads and
 * the four bad ones are refused with their reasons.
 *
 * The signing fixture mirrors apps/cli/tests/plugin-provenance-install.spec.ts:
 * ed25519 keys, an arbitrary fingerprint string the anchor and the signature
 * share, and the trusted key's SPKI PEM in the anchor so the loader can verify
 * a signature made over the definition's digest.
 */

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import { runProfile } from '../../../apps/cli/src/profile-boot.ts'

const LAUNCH_TIMEOUT_MS = 60_000

/** The trust anchor's fingerprint (an opaque label; the anchor and signature share it). */
const TRUSTED_FP = 'sha256:trusted-saved-workflow-key'
/** A fingerprint no anchor admits, for the no-trust-anchor case. */
const UNTRUSTED_FP = 'sha256:untrusted-saved-workflow-key'

const trusted = generateKeyPairSync('ed25519')
const untrusted = generateKeyPairSync('ed25519')

/** The SPKI PEM the anchor carries so the loader can verify a signature. */
function pem(key: { publicKey: KeyObject }): string {
  return key.publicKey.export({ type: 'spki', format: 'pem' }).toString()
}

/** The base64 ed25519 signature over a definition's digest string. */
function signDigest(digest: string, key: { privateKey: KeyObject }): string {
  return Buffer.from(sign(null, Buffer.from(digest), key.privateKey)).toString('base64')
}

/** What a saved-workflow signature file carries beside its `<name>.js`. */
interface SignatureFile {
  readonly digest: string
  readonly publicKeyFingerprint: string
  readonly signature: string
}

/** What the driver reads back from `ctx.savedWorkflows`. */
interface SavedWorkflows {
  readonly loaded: readonly string[]
  readonly refused: readonly { readonly name: string; readonly reason: string }[]
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Boot a factory profile whose `dsh.trustAnchors` admits the trusted key, with
 * the given definition files and signature files under `$DSH_HOME/workflows`,
 * and return what its saved-workflow loader loaded and refused.
 * @param files - the `workflows/` directory contents (`<name>.js`, `<name>.js.sig.json`).
 * @returns `ctx.savedWorkflows`, or undefined when the base mounts no loader.
 */
async function bootWithWorkflows(files: Readonly<Record<string, string>>): Promise<SavedWorkflows | undefined> {
  const root = mkdtempSync(join(tmpdir(), 'p4-09-saved-'))
  roots.push(root)
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(cwd, { recursive: true })
  const profileDir = join(home, 'profiles', 'p4-09-saved')
  mkdirSync(profileDir, { recursive: true })
  // A base-bundle factory profile (the base layer is where the workflow engine
  // lives, and where B-698 mounts the loader), declaring the trusted anchor.
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-p4-09-saved',
    private: true,
    dependencies: {},
    dsh: {
      profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'startup', development: true },
      trustAnchors: [{ mode: 'offline-signed', publicKeyFingerprint: TRUSTED_FP, owner: 'test', publicKeyPem: pem(trusted) }],
    },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  const workflowsDir = join(home, 'workflows')
  mkdirSync(workflowsDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(workflowsDir, name), content)
  process.env.DSH_HOME = home
  // A development profile boots without the insecure opt-in needing to be set;
  // the kernel is pinned from the profile's own anchors.
  delete process.env.DSH_TRUST_KERNEL_INSECURE
  return runProfile({
    environment: loadLayeredEnv('dsh', cwd),
    profile: 'p4-09-saved',
    fromDefaultProfile: undefined,
    patchFiles: [],
    args: [],
  }).then(
    async ({ ctx }) => {
      const saved = ctx.get('savedWorkflows') as SavedWorkflows | undefined
      // Copy out before disposal so the returned value survives teardown.
      const snapshot = saved === undefined ? undefined : { loaded: [...saved.loaded], refused: saved.refused.map(entry => ({ ...entry })) }
      await ctx.fiber.dispose()
      return snapshot
    },
    () => undefined,
  )
}

/** A definition file, its digest, and its signature file signed over that digest by `key` under `fingerprint`. */
function signed(body: string, key: { privateKey: KeyObject }, fingerprint: string): { body: string; sig: SignatureFile } {
  const digest = computeDefinitionDigest(body)
  return { body, sig: { digest, publicKeyFingerprint: fingerprint, signature: signDigest(digest, key) } }
}

describe('P4-09 acceptance[0]: a shipped profile runs a saved workflow only when it is signed by an admitted key (red first, paired with B-698)', () => {
  it('loads the signed definition and refuses the tampered, unsigned, unanchored, and badly-signed ones with their reasons', async () => {
    const valid = signed("return 'ok'", trusted, TRUSTED_FP)
    // Tampered: the signature is over the ORIGINAL digest, but the body on disk
    // is different, so the recomputed digest does not match the signed one.
    const original = signed("return 'original'", trusted, TRUSTED_FP)
    const tamperedBody = "return 'tampered'"
    // Unanchored: validly signed by a key whose fingerprint no anchor admits.
    const unanchored = signed("return 'no anchor'", untrusted, UNTRUSTED_FP)
    // Bad signature: the right fingerprint and digest, but corrupt signature bytes.
    const badBody = "return 'bad signature'"
    const badDigest = computeDefinitionDigest(badBody)
    const badSig: SignatureFile = { digest: badDigest, publicKeyFingerprint: TRUSTED_FP, signature: Buffer.from('not a real signature').toString('base64') }

    const saved = await bootWithWorkflows({
      'valid.js': valid.body,
      'valid.js.sig.json': JSON.stringify(valid.sig),
      'tampered.js': tamperedBody,
      'tampered.js.sig.json': JSON.stringify(original.sig),
      'unsigned.js': "return 'unsigned'",
      'unanchored.js': unanchored.body,
      'unanchored.js.sig.json': JSON.stringify(unanchored.sig),
      'badsig.js': badBody,
      'badsig.js.sig.json': JSON.stringify(badSig),
    })

    // Harness + mounting: the factory base must expose the saved-workflow
    // loader. RED today — the base mounts none, so this is undefined.
    expect(saved, 'the factory base must mount the saved-workflow loader').toBeDefined()
    const loaded = saved?.loaded ?? []
    const refusedByName = new Map((saved?.refused ?? []).map(entry => [entry.name, entry.reason]))
    const detail = JSON.stringify(saved)

    // The valid definition is admitted (and so runnable); the four bad ones are
    // refused, each naming its reason.
    expect(loaded, detail).toContain('valid')
    expect(refusedByName.get('tampered'), detail).toContain('digest-mismatch')
    expect(refusedByName.get('unsigned'), detail).toContain('unsigned')
    expect(refusedByName.get('unanchored'), detail).toContain('no-trust-anchor')
    expect(refusedByName.get('badsig'), detail).toContain('signature-invalid')
  }, LAUNCH_TIMEOUT_MS)
})
