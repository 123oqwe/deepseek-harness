/**
 * P4-09 acceptance[0], question 31 (a): a saved workflow definition is run by a
 * shipped profile only when it is signed by a key the profile's
 * `dsh.trustAnchors` admits; a definition whose body changed, whose signature
 * is missing, whose key is not anchored, or whose signature does not verify is
 * refused, and the refusal names the reason.
 *
 * Observed on the FACTORY LAUNCHER (the built `dsh` bin in `lib` mode, as a
 * subprocess), not in-process. An in-process spec imports the trust kernel from
 * `src` while the shipped loader loads it through Node's ESM from `lib`, giving
 * two anchor registries so the loader refuses every definition with
 * `no-trust-anchor` (A-578's src/lib split). A `lib`-mode subprocess keeps the
 * whole graph on `lib`, so the loader finds the profile's anchor. A test-only
 * `.mjs` sentinel mounted in the profile records the loader's result (loaded +
 * refused reasons) to a marker file on `appReady`; this reads the finished
 * async load rather than relying on mount order.
 *
 * Red first, paired with B-698's fourth commit (which mounts the saved-workflow
 * loader into the factory base and verifies each definition's signature).
 * §21.4: B-698 is not read. Today the shipped base mounts no loader, so the
 * marker records `savedWorkflows` absent and every assertion fails; B-698 mounts
 * and verifies it, so the valid definition loads and the four bad ones are
 * refused with their reasons. The fingerprint is an opaque label the anchor and
 * signature share (as apps/cli/tests/plugin-provenance-install.spec.ts does).
 */

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'

/** The app bin whose `lib` build the subprocess runs. */
const BIN_SCRIPT = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
/** The repo tsconfig (unused in `lib` mode, but the smoke options require it). */
const TSCONFIG = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
/** The test-only `.mjs` sentinel that records the loader's result to the marker. */
const SENTINEL = fileURLToPath(new URL('./P4-09.saved-workflows-marker.mjs', import.meta.url))

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

/** What the sentinel records to the marker. */
interface MarkerResult {
  readonly present: boolean
  readonly loaded?: readonly string[]
  readonly refused?: readonly { readonly name: string; readonly reason: string }[]
}

/** What the driver reads back for `ctx.savedWorkflows`. */
interface SavedWorkflows {
  readonly loaded: readonly string[]
  readonly refused: readonly { readonly name: string; readonly reason: string }[]
}

/**
 * Launch the built `dsh` bin against a base-bundle factory profile whose
 * `dsh.trustAnchors` admits the trusted key, with the given definition and
 * signature files under `$DSH_HOME/workflows`, and return what the saved-workflow
 * loader loaded and refused (read back from the sentinel's marker).
 * @param files - the `workflows/` directory contents (`<name>.js`, `<name>.js.sig.json`).
 * @returns the load result, or undefined when the base mounts no loader.
 */
async function bootWithWorkflows(files: Readonly<Record<string, string>>): Promise<SavedWorkflows | undefined> {
  let observed: MarkerResult | undefined
  await runLoaderSmoke({
    label: 'p4-09-saved-workflow-signing',
    tempDirPrefix: 'p4-09-saved-',
    binScript: BIN_SCRIPT,
    configPath: '',
    binArgs: ['--profile', 'p4-09-saved'],
    tsconfigPath: TSCONFIG,
    mode: 'lib',
    prepare: (cwd) => {
      // runLoaderSmoke points DSH_HOME at <cwd>/.dsh.
      const home = join(cwd, '.dsh')
      const profileDir = join(home, 'profiles', 'p4-09-saved')
      mkdirSync(profileDir, { recursive: true })
      const marker = join(cwd, 'saved-workflows-marker.json')
      // A base-bundle factory profile (the base layer is where the workflow
      // engine lives, and where B-698 mounts the loader), declaring the anchor.
      writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
        name: 'dsh-profile-p4-09-saved',
        private: true,
        dependencies: {},
        dsh: {
          // No `development` flag: a shipped posture pins a real Trust Kernel and
          // reads `dsh.trustAnchors`, and its default manifest posture (shadow)
          // still admits the manifestless marker sentinel. A development profile
          // would change signing admission (profile-boot.ts's P1-02
          // unsigned-development path) and corrupt the `unsigned` refusal.
          profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'startup' },
          trustAnchors: [{ mode: 'offline-signed', publicKeyFingerprint: TRUSTED_FP, owner: 'test', publicKeyPem: pem(trusted) }],
        },
      }, undefined, 2)}\n`)
      // The marker sentinel mounts after the base bundle and reads
      // ctx.savedWorkflows on appReady, writing the result to the marker.
      writeFileSync(
        join(profileDir, 'cordis.patch.yml'),
        `- insert:\n    - id: p4-09-saved-workflows-marker\n      name: '${SENTINEL}'\n      config:\n        marker: '${marker}'\n`,
      )
      const workflowsDir = join(home, 'workflows')
      mkdirSync(workflowsDir, { recursive: true })
      for (const [name, content] of Object.entries(files)) writeFileSync(join(workflowsDir, name), content)
    },
    inspect: (cwd) => {
      const marker = join(cwd, 'saved-workflows-marker.json')
      if (existsSync(marker)) observed = JSON.parse(readFileSync(marker, 'utf8')) as MarkerResult
    },
  })
  if (observed === undefined || !observed.present) return undefined
  return { loaded: observed.loaded ?? [], refused: (observed.refused ?? []).map(entry => ({ ...entry })) }
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
    // loader. RED today — the base mounts none, so the marker records it absent.
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
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
