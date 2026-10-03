/**
 * A-602 (P4-09 acceptance[0] on a Web preset; blind review 2-6): the Web app runs
 * each session on the workflow engine inside its preset's `isolate:
 * workflowEngine` delegation group, where `workflow-filesystem` registers a saved
 * definition from `$DSH_HOME/workflows` only when the signature beside it verifies
 * against the profile's offline-signed `dsh.trustAnchors`. The base engine's
 * load/refuse is observed by A-581; the per-preset engine has only been checked
 * structurally. This observes it behaviourally on the shipped `standard` preset.
 *
 * Observed on the FACTORY LAUNCHER (the built `dsh` bin in `lib` mode, as a
 * subprocess), because the loader verifies against the trust-kernel module's
 * private anchors; an in-process boot imports that module twice (src and lib) and
 * splits the anchors, so signed and unsigned become indistinguishable (A-578).
 * The profile bundles the shipped Web composition (`dsh-base` + `dsh-web-app`),
 * declares the anchor, disables the host rows that bind a port or serve assets,
 * and mounts a root sentinel. The sentinel composes ONE session from the factory
 * `standard` preset the way the Web session controller does
 * (session-controller/src/agent.ts:481-490), reads that session's preset-isolate
 * engine `savedWorkflows`, and writes the result; the preset file is unchanged, so
 * what is observed is the shipped preset engine.
 *
 * Prediction — GREEN evidence: the loader reads `ctx.get('trustKernel')`
 * (workflow-filesystem/src/index.ts:269), and `trustKernel` is not published
 * inside the preset isolate (standard/agent.cordis.yml:171-173), so the preset
 * engine resolves the PINNED kernel and verifies — the signed definition
 * registers and the unsigned one is refused. If the signed one is refused too,
 * that is the gap blind 2-6 leaves open, and this reds on it.
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
/** The root sentinel that composes a `standard` session and reads its preset engine. */
const SENTINEL = fileURLToPath(new URL('./loader/a-602-web-preset-workflow-signing/marker.mjs', import.meta.url))

/** The trust anchor's fingerprint (an opaque label the anchor and signature share). */
const TRUSTED_FP = 'sha256:trusted-web-preset-workflow-key'

const trusted = generateKeyPairSync('ed25519')

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

/** A definition body and its signature file signed over that body's digest. */
function signed(body: string): { body: string; sig: SignatureFile } {
  const digest = computeDefinitionDigest(body)
  return { body, sig: { digest, publicKeyFingerprint: TRUSTED_FP, signature: signDigest(digest, trusted) } }
}

/** What the sentinel records to the marker. */
interface MarkerReading {
  readonly sessionCreated: boolean
  readonly present: boolean
  readonly loaded?: readonly string[] | null
  readonly refused?: readonly { readonly name: string; readonly reason: string }[] | null
  readonly error?: string
  readonly reason?: string
}

/** The Web host rows that bind a port, serve assets, or need a live client; disabled so the lib boot reaches appReady without them. */
const DISABLED_HOST_ROWS = [
  'webserver', 'web-runtime', 'connection', 'session-telemetry-otel',
  'open-in-app', 'client-hmr', 'directory-picker', 'session-log-download', 'modules',
] as const

/**
 * Launch the built `dsh` bin against a Web-composition profile that admits the
 * trusted key, with the given definition and signature files under
 * `$DSH_HOME/workflows`, and return what the sentinel recorded from the `standard`
 * preset's own engine.
 * @param files - the `workflows/` directory contents.
 * @returns the sentinel's reading.
 * @throws when the boot wrote no marker (it failed before the session), with the stderr tail.
 */
async function bootWebPresetWorkflows(files: Readonly<Record<string, string>>): Promise<MarkerReading> {
  let observed: MarkerReading | undefined
  const { stderr } = await runLoaderSmoke({
    label: 'p4-09-web-preset-workflow-signing',
    tempDirPrefix: 'p4-09-web-preset-',
    binScript: BIN_SCRIPT,
    configPath: '',
    binArgs: ['--profile', 'p4-09-web-preset'],
    tsconfigPath: TSCONFIG,
    mode: 'lib',
    prepare: (cwd) => {
      const home = join(cwd, '.dsh')
      const profileDir = join(home, 'profiles', 'p4-09-web-preset')
      mkdirSync(profileDir, { recursive: true })
      const marker = join(cwd, 'web-preset-workflows-marker.json')
      writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
        name: 'dsh-profile-p4-09-web-preset',
        private: true,
        dependencies: {},
        dsh: {
          profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'startup' },
          trustAnchors: [{ mode: 'offline-signed', publicKeyFingerprint: TRUSTED_FP, owner: 'test', publicKeyPem: pem(trusted) }],
        },
      }, undefined, 2)}\n`)
      writeFileSync(join(profileDir, 'cordis.patch.yml'), [
        '- insert:',
        '    - id: a-602-web-preset-workflow-marker',
        `      name: '${SENTINEL}'`,
        '      config:',
        `        marker: '${marker}'`,
        // The shipped presets are the plugin's own; pin the roster off the
        // developer's machine so the factory `standard` is what composes.
        '- id: agent-presets',
        '  config:',
        '    default: standard',
        '    includeUserRoot: false',
        ...DISABLED_HOST_ROWS.flatMap(id => [`- id: ${id}`, '  disabled: true']),
        '',
      ].join('\n'))
      const workflowsDir = join(home, 'workflows')
      mkdirSync(workflowsDir, { recursive: true })
      for (const [name, content] of Object.entries(files)) writeFileSync(join(workflowsDir, name), content)
    },
    inspect: (cwd) => {
      const marker = join(cwd, 'web-preset-workflows-marker.json')
      if (existsSync(marker)) observed = JSON.parse(readFileSync(marker, 'utf8')) as MarkerReading
    },
  })
  if (observed === undefined) {
    throw new Error(`the web-preset driver wrote no marker (the boot failed before the session was composed); stderr tail:\n${stderr.slice(-1500)}`)
  }
  return observed
}

describe('P4-09 acceptance[0] on a Web preset (A-602, blind 2-6): the standard preset engine registers a signed saved workflow and refuses an unsigned one', () => {
  it('loads the signed definition and refuses the unsigned one, observed on the shipped standard preset engine', async () => {
    const valid = signed("return 'ok'")

    const reading = await bootWebPresetWorkflows({
      'valid.js': valid.body,
      'valid.js.sig.json': JSON.stringify(valid.sig),
      'unsigned.js': "return 'unsigned'",
    })

    // Harness guards (the delegate's "boot succeeded + session created"): the
    // sentinel composed a `standard` session and the preset isolate published its
    // own saved-workflow engine, so "loaded/refused" below reads that engine and
    // not an absence. (A boot that wrote no marker already threw with its stderr.)
    expect(reading.sessionCreated, JSON.stringify(reading)).toBe(true)
    expect(reading.present, JSON.stringify(reading)).toBe(true)

    const loaded = reading.loaded ?? []
    const refusedByName = new Map((reading.refused ?? []).map(entry => [entry.name, entry.reason]))
    const detail = JSON.stringify(reading)
    // GREEN evidence today: the preset engine reaches the pinned kernel, so the
    // signed definition registers and the unsigned one is refused as `unsigned`.
    expect(loaded, detail).toContain('valid')
    expect(refusedByName.get('unsigned'), detail).toContain('unsigned')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
