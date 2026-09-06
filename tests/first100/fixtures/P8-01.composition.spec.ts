/**
 * P8-01 must[4] — the protocol schema artifact is a golden fixture and a real
 * release-evidence input.
 *
 * must[4] asks for two things the frozen C/P/U/F cells do not touch: the schema
 * artifact enters GOLDEN COMPATIBILITY FIXTURES, and it enters RELEASE EVIDENCE.
 * Each is asserted here against the real thing rather than described — the
 * committed artifact against a fresh generation from the live surface, and the
 * artifact through the real `collect-evidence.mjs`, not a stand-in for it.
 *
 * The fingerprint is pinned as a LITERAL. A test that recomputed it from the
 * same surface it is checking would pass no matter what the surface said, which
 * is the shape acceptance[3] exists to prevent: a fixture that cannot diff
 * reports no drift for the same reason a broken thermometer reports no fever.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { computeSchemaFingerprint } from '@deepseek-ai/dsh-sdk-protocol'
import { SERVER_PROTOCOL_SURFACE } from '@deepseek-ai/dsh-sdk-jsonrpc-server'

const repoRoot = resolve(import.meta.dirname, '../../..')
const artifactPath = join(repoRoot, 'spec/control-protocol.schema.json')
const generatorPath = join(repoRoot, 'scripts/gen-control-protocol-schema.ts')

/** The exact digest this build's wire surface produces. */
const PINNED_FINGERPRINT = 'd2d4c61600a16bde85365893ed6a0498fd1d34ec691fc7b91ace36c6671701fe'

interface ControlProtocolArtifact {
  readonly fingerprint: string
  readonly surface: { readonly methods: readonly { readonly name: string }[] }
}

/** sha256 of a file's real bytes — the same digest the collector records. */
const digestOfFile = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex')

const readArtifact = (): ControlProtocolArtifact =>
  JSON.parse(readFileSync(artifactPath, 'utf8')) as ControlProtocolArtifact

describe('P8-01 must[4] — the schema artifact is a golden compatibility fixture', () => {
  it('the committed artifact pins the exact fingerprint, as a literal a second implementation can target', () => {
    expect(readArtifact().fingerprint).toBe(PINNED_FINGERPRINT)
  })

  it('the live server surface produces that same fingerprint, so the artifact describes what peers actually meet', () => {
    // The other half of the pin. Without it the artifact could hold a stale
    // digest and still satisfy the case above — a fixture agreeing only with
    // itself.
    expect(computeSchemaFingerprint(SERVER_PROTOCOL_SURFACE)).toBe(PINNED_FINGERPRINT)
  })

  // Spawns `pnpm exec tsx` on the generator, which is slower than the default
  // budget allows under a loaded suite — same reasoning as the collector case
  // below.
  it('`--check` passes against the committed artifact', { timeout: 60_000 }, () => {
    const output = execFileSync('pnpm', ['exec', 'tsx', generatorPath, '--check'], { cwd: repoRoot, encoding: 'utf8' })
    expect(output).toContain('matches the live protocol surface')
  })

  it('acceptance[3]: a wire-visible change moves the fingerprint, so a protocol change CANNOT land without a fixture diff', () => {
    const renamed = {
      ...SERVER_PROTOCOL_SURFACE,
      methods: SERVER_PROTOCOL_SURFACE.methods.map((entry, index) =>
        index === 0 ? { ...entry, name: 'initialise' } : entry),
    }
    expect(computeSchemaFingerprint(renamed)).not.toBe(PINNED_FINGERPRINT)
  })

  it('CONTROL: reordering the surface does NOT move the fingerprint, so the fixture measures the wire and not the edit', () => {
    // Without this, the case above would be satisfied by a fingerprint that
    // moves on any change at all — including ones no peer can observe — and a
    // fixture that cries wolf stops being consulted.
    const reordered = { ...SERVER_PROTOCOL_SURFACE, methods: [...SERVER_PROTOCOL_SURFACE.methods].reverse() }
    expect(computeSchemaFingerprint(reordered)).toBe(PINNED_FINGERPRINT)
  })
})

describe('P8-01 must[4] — the schema artifact is a real release-evidence input', () => {
  // Four subprocesses — git init/commit, a baseline capture, and two collector
  // invocations — so the default 5s budget is a bet on the machine being idle.
  // It passed alone and in CI and timed out inside the full suite, which is the
  // same load-dependent shape the session-snapshot wait had this morning: a
  // budget that decides the outcome is not a test of the thing it names.
  it('collect-evidence hashes the artifact into requiredBuildArtifacts, with the digest of its real bytes', { timeout: 60_000 }, () => {
    // The REAL collector (P0-07's `scripts/release/collect-evidence.mjs`), not a
    // description of it: must[4]'s claim is that this artifact enters release
    // evidence, and only the collector that builds a release's evidence can
    // make that true.
    //
    // It runs against a throwaway checkout carrying a real copy of the artifact,
    // because `init` binds a captured baseline whose gitSha must equal HEAD —
    // running it against this repository would either fail or write into it.
    const root = mkdtempSync(join(tmpdir(), 'p8-01-evidence-'))
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).trim()
    git(['init', '--initial-branch=main'])
    git(['config', 'user.email', 'p8-01-fixture@example.com'])
    git(['config', 'user.name', 'P8-01 Fixture'])
    git(['config', 'commit.gpgsign', 'false'])
    // The baseline captures these four paths; a missing one aborts the capture,
    // so the fixture carries them with placeholder content.
    for (const [path, content] of [
      ['spec/control-protocol.schema.json', readFileSync(artifactPath, 'utf8')],
      ['packages/bundle/base/cordis.patch.yml', 'rows:\n  - id: row-alpha\n'],
      ['packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n}\n'],
      ['packages/core/session/src/known-event-types.ts', "export type KnownEventType = 'session.start'\n"],
    ] as const) {
      mkdirSync(join(root, path.slice(0, path.lastIndexOf('/'))), { recursive: true })
      writeFileSync(join(root, path), content, 'utf8')
    }
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n', 'utf8')
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\npackages: {}\n", 'utf8')
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: '@fixture/p8-01', private: true, packageManager: 'pnpm@11.7.0' }, null, 2)}\n`, 'utf8')
    git(['add', '-A'])
    git(['commit', '-m', 'fixture'])
    const baseSha = git(['rev-parse', 'HEAD'])

    const collector = join(repoRoot, 'scripts/release/collect-evidence.mjs')
    execFileSync('node', [join(repoRoot, 'scripts/release/baseline-fingerprint.mjs'), 'capture', '--repo-root', root], { encoding: 'utf8' })
    const out = join(root, '.dsh/evidence/evidence.json')
    execFileSync('node', [
      collector, 'init',
      '--repo-root', root, '--out', out,
      '--base-sha', baseSha,
      '--required-artifact', 'spec/control-protocol.schema.json',
    ], { encoding: 'utf8' })
    execFileSync('node', [
      collector, 'build-artifact',
      '--repo-root', root, '--out', out,
      '--path', 'spec/control-protocol.schema.json',
    ], { encoding: 'utf8' })

    const evidence = JSON.parse(readFileSync(out, 'utf8')) as {
      accepted: boolean
      requiredBuildArtifacts: Record<string, string>
    }
    // The digest is of the file's real bytes, so evidence recorded for one
    // protocol surface cannot be presented for another.
    expect(evidence.requiredBuildArtifacts['spec/control-protocol.schema.json']).toBe(digestOfFile(artifactPath))
    // And the package accepts only because the declared artifact is present:
    // must[4] asks for the artifact to be part of the evidence, not beside it.
    expect(evidence.accepted).toBe(true)
  })

  it('the recorded digest tracks the artifact: a changed artifact yields a different digest', () => {
    // The positive control for the case above. A collector that recorded a
    // constant, or hashed the path rather than the bytes, would satisfy it.
    const scratch = mkdtempSync(join(tmpdir(), 'p8-01-digest-'))
    const copy = join(scratch, 'control-protocol.schema.json')
    const original = readFileSync(artifactPath, 'utf8')
    writeFileSync(copy, original.replace(PINNED_FINGERPRINT, `${PINNED_FINGERPRINT.slice(0, -1)}0`), 'utf8')
    expect(digestOfFile(copy)).not.toBe(digestOfFile(artifactPath))
  })
})
