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
/** The root sentinel that composes a session from the observed preset copy. */
const SENTINEL = fileURLToPath(new URL('./loader/a-602-web-preset-workflow-signing/marker.mjs', import.meta.url))
/** The read-only observer inserted INSIDE the preset's workflow delegation group, where `savedWorkflows` lives. */
const OBSERVER = fileURLToPath(new URL('./loader/a-602-web-preset-workflow-signing/group-observer.mjs', import.meta.url))
/** The shipped `standard` preset the copy is derived from byte-for-byte. */
const FACTORY_STANDARD = fileURLToPath(new URL('../../../packages/preset/agent-presets/presets/standard/agent.cordis.yml', import.meta.url))
/** The distinct id of the copied preset (a user preset named `standard` would be shadowed by the shipped one). */
const OBSERVED_PRESET = 'a602-observed'

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

/** What the root sentinel records: whether it composed the preset session. */
interface SessionReading {
  readonly sessionCreated: boolean
  readonly error?: string
  readonly reason?: string
}

/** What the in-group observer records from the preset isolate's own engine. */
interface ObserverReading {
  readonly present: boolean
  readonly loaded: readonly string[] | null
  readonly refused: readonly { readonly name: string; readonly reason: string }[] | null
}

/** Everything the launch produced: both markers plus the copied preset and the factory it derives from, for the byte-identity check. */
interface WebPresetObservation {
  readonly session: SessionReading
  readonly observer: ObserverReading | undefined
  readonly preset: string
  readonly factory: string
  readonly observerBlock: string
}

/** The exact factory rows the observer is spliced in behind; must appear once. */
const WORKFLOW_FILESYSTEM_ANCHOR = "    - id: workflow-filesystem\n      name: '@deepseek-ai/dsh-workflow-filesystem'\n"

/** The Web host rows that bind a port, serve assets, or need a live client; disabled so the lib boot reaches appReady without them. */
const DISABLED_HOST_ROWS = [
  'webserver', 'web-runtime', 'connection', 'session-telemetry-otel',
  'open-in-app', 'client-hmr', 'directory-picker', 'session-log-download', 'modules',
] as const

/**
 * Launch the built `dsh` bin against a Web-composition profile that admits the
 * trusted key, with the given definition and signature files under
 * `$DSH_HOME/workflows`. The profile mounts a root sentinel that composes one
 * session from a COPY of the shipped `standard` preset — byte-identical except
 * for one read-only observer row spliced into the `savedWorkflows`-isolating
 * `delegation` group — and that observer, sharing the group's realm, reads the
 * preset engine's loaded/refused and writes them.
 * @param files - the `workflows/` directory contents.
 * @returns both markers and the copied-vs-factory preset text.
 * @throws when the boot wrote no session marker (it failed before the session), with the stderr tail.
 */
async function bootWebPresetWorkflows(files: Readonly<Record<string, string>>): Promise<WebPresetObservation> {
  const factory = readFileSync(FACTORY_STANDARD, 'utf8')
  let session: SessionReading | undefined
  let observer: ObserverReading | undefined
  let observerBlock = ''
  let preset = ''
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
      const sessionMarker = join(cwd, 'web-preset-session-marker.json')
      const observerMarker = join(cwd, 'web-preset-observer-marker.json')
      // The copied preset: factory `standard` with one observer row added inside
      // the `delegation` group behind `workflow-filesystem`. The observer injects
      // `savedWorkflows`, so it mounts after the loader has run and reads the same
      // isolated engine. Removing this block must yield the factory byte-for-byte
      // (asserted below), which is how the copy proves it changed nothing else.
      observerBlock = [
        '', `    - id: a-602-group-observer`, `      name: '${OBSERVER}'`,
        '      config:', `        marker: '${observerMarker}'`, '',
      ].join('\n')
      preset = factory.replace(WORKFLOW_FILESYSTEM_ANCHOR, WORKFLOW_FILESYSTEM_ANCHOR + observerBlock)
      const presetDir = join(home, '.agent-presets', OBSERVED_PRESET)
      mkdirSync(presetDir, { recursive: true })
      writeFileSync(join(presetDir, 'agent.cordis.yml'), preset)
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
        `        marker: '${sessionMarker}'`,
        `        preset: '${OBSERVED_PRESET}'`,
        // Admit the user root so the copied preset is discovered and mountable.
        '- id: agent-presets',
        '  config:',
        `    default: ${OBSERVED_PRESET}`,
        '    includeUserRoot: true',
        ...DISABLED_HOST_ROWS.flatMap(id => [`- id: ${id}`, '  disabled: true']),
        '',
      ].join('\n'))
      const workflowsDir = join(home, 'workflows')
      mkdirSync(workflowsDir, { recursive: true })
      for (const [name, content] of Object.entries(files)) writeFileSync(join(workflowsDir, name), content)
    },
    inspect: (cwd) => {
      const sessionMarker = join(cwd, 'web-preset-session-marker.json')
      const observerMarker = join(cwd, 'web-preset-observer-marker.json')
      if (existsSync(sessionMarker)) session = JSON.parse(readFileSync(sessionMarker, 'utf8')) as SessionReading
      if (existsSync(observerMarker)) observer = JSON.parse(readFileSync(observerMarker, 'utf8')) as ObserverReading
    },
  })
  if (session === undefined) {
    throw new Error(`the web-preset driver wrote no session marker (the boot failed before the session was composed); stderr tail:\n${stderr.slice(-1500)}`)
  }
  return { session, observer, preset, factory, observerBlock }
}

describe('P4-09 acceptance[0] on a Web preset (A-602, blind 2-6): the standard preset engine registers a signed saved workflow and refuses an unsigned one', () => {
  it('loads the signed definition and refuses the unsigned one, observed inside a byte-identical copy of the standard preset engine group', async () => {
    const valid = signed("return 'ok'")

    const observation = await bootWebPresetWorkflows({
      'valid.js': valid.body,
      'valid.js.sig.json': JSON.stringify(valid.sig),
      'unsigned.js': "return 'unsigned'",
    })
    const detail = JSON.stringify({ session: observation.session, observer: observation.observer })

    // The copied preset changed nothing but the one observer row: removing that
    // block yields the factory `standard` byte-for-byte. So what the observer
    // reads below is the shipped preset engine, not a divergent composition.
    expect(observation.preset.includes('a-602-group-observer'), 'the workflow-filesystem anchor was not found, so the observer was never spliced in').toBe(true)
    expect(observation.factory.includes(observation.observerBlock), 'the observer row leaked into the factory text').toBe(false)
    expect(observation.preset.split(observation.observerBlock).join(''), 'the copy diverges from factory standard beyond the observer row')
      .toBe(observation.factory)

    // Harness guards (the delegate's "boot succeeded + session created"): the
    // sentinel composed the copied preset session, and its `delegation` group
    // published its own saved-workflow engine, so "loaded/refused" reads that
    // engine and not an absence. (A boot that wrote no session marker already threw.)
    expect(observation.session.sessionCreated, detail).toBe(true)
    expect(observation.observer, detail).toBeDefined()
    expect(observation.observer?.present, detail).toBe(true)

    const loaded = observation.observer?.loaded ?? []
    const refusedByName = new Map((observation.observer?.refused ?? []).map(entry => [entry.name, entry.reason] as const))
    // GREEN evidence today: the preset engine reaches the pinned kernel, so the
    // signed definition registers and the unsigned one is refused as `unsigned`.
    expect(loaded, detail).toContain('valid')
    expect(refusedByName.get('unsigned'), detail).toContain('unsigned')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
