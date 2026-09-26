/**
 * P1-02's install path, below pnpm: which dependencies a `dsh plugin` run
 * verifies, and how a claim file that cannot be used is refused. The verdicts
 * a real install reaches are observed end to end in
 * `plugin-provenance-install.spec.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recordUnverifiedProvenance, type ProvenanceAuditRecord } from '@deepseek-ai/dsh-plugin-provenance'
import { computePackageDigest } from '@deepseek-ai/dsh-plugin-provenance/signature'
import { CLAIM_FILE_SUFFIX, verifyInstallProvenance } from '../src/install-provenance.ts'

const dirs: string[] = []
const NO_LOCK = new Map<string, ProvenanceAuditRecord>()
/** A package name no workspace package uses, so nothing resolves it by accident. */
const PROBE = 'dsh-p1-02-install-provenance-unit-probe'

/**
 * A profile directory holding one tarball, with an optional claim file beside it.
 * @param claim - the claim file's text, or `undefined` for none.
 * @returns the directory and the tarball's spec relative to it.
 */
function profileWithTarball(claim: string | undefined): { dir: string; spec: string; bytes: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-provenance-'))
  dirs.push(dir)
  const bytes = Buffer.from('not really a tarball')
  writeFileSync(join(dir, 'probe-1.0.0.tgz'), bytes)
  if (claim !== undefined) writeFileSync(join(dir, `probe-1.0.0.tgz${CLAIM_FILE_SUFFIX}`), claim)
  return { dir, spec: 'file:probe-1.0.0.tgz', bytes }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const WELL_FORMED = JSON.stringify({
  claim: {
    packageDigest: 'sha256:0',
    sourceCommit: { repoUrl: 'https://example.com/probe', commitHash: 'a'.repeat(40) },
    builderIdentity: 'builder',
    sbomDigest: 'sha256:1',
    evidence: { mode: 'offline-signed', signature: Buffer.from('sig').toString('base64'), publicKeyFingerprint: 'sha256:key' },
  },
  sbom: { format: 'cyclonedx', subjectPackageDigest: 'sha256:0', generatedAt: '2026-09-26T00:00:00.000Z', entries: [] },
})

describe('P1-02: which dependencies an install verifies', () => {
  it('records an added dependency with no claim unverified, and leaves an unchanged one to the lock', () => {
    const { dir, spec } = profileWithTarball(undefined)
    const result = verifyInstallProvenance({ kept: '^1.0.0' }, { kept: '^1.0.0', added: '^2.0.0', [PROBE]: spec }, dir, [], NO_LOCK)

    expect(result.refused).toEqual([])
    expect([...result.records.keys()].sort()).toEqual([PROBE, 'added'].sort())
    expect(result.records.get(PROBE)).toMatchObject({ trust: 'unverified', reason: 'no-provenance-claim' })
  })

  it('verifies an unchanged spec again when its tarball no longer matches the recorded digest', () => {
    const { dir, spec, bytes } = profileWithTarball('{ not json')
    const matching = new Map([[PROBE, { ...recordUnverifiedProvenance('no-provenance-claim', 'then'), packageDigest: computePackageDigest(bytes) }]])
    expect(verifyInstallProvenance({ [PROBE]: spec }, { [PROBE]: spec }, dir, [], matching).refused).toEqual([])

    const stale = new Map([[PROBE, { ...recordUnverifiedProvenance('no-provenance-claim', 'then'), packageDigest: computePackageDigest(Buffer.from('old')) }]])
    expect(verifyInstallProvenance({ [PROBE]: spec }, { [PROBE]: spec }, dir, [], stale).refused)
      .toEqual([{ name: PROBE, reason: expect.stringMatching(/^claim-unreadable: /u) as unknown as string }])
  })
})

describe('P1-02: a claim file that cannot be used refuses the install', () => {
  it('refuses a file that is not JSON, not a claim, or has a malformed field', () => {
    const cases: readonly [string, RegExp][] = [
      ['{ not json', /^claim-unreadable: /u],
      ['[]', /^claim-unreadable: the file must be an object$/u],
      [JSON.stringify({ claim: {}, sbom: {} }), /^claim-unreadable: claim\.sourceCommit must be an object$/u],
      [WELL_FORMED.replace('"offline-signed"', '"pgp"'), /^claim-unreadable: claim\.evidence\.mode must be/u],
      [WELL_FORMED.replace('"cyclonedx"', '"csv"'), /^claim-unreadable: sbom\.format must be/u],
      [WELL_FORMED.replace('"entries":[]', '"entries":[{"name":"x","version":"1","kind":"build"}]'), /^claim-unreadable: sbom\.entries\[0\]\.kind must be/u],
    ]
    for (const [claim, reason] of cases) {
      const { dir, spec } = profileWithTarball(claim)
      const refused = verifyInstallProvenance({}, { [PROBE]: spec }, dir, [], NO_LOCK).refused
      expect(refused.map(entry => entry.reason), claim).toEqual([expect.stringMatching(reason)])
    }
  })

  it('refuses a well-formed claim whose package pnpm left unresolvable', () => {
    const { dir, spec } = profileWithTarball(WELL_FORMED)
    expect(verifyInstallProvenance({}, { [PROBE]: spec }, dir, [], NO_LOCK).refused)
      .toEqual([{ name: PROBE, reason: 'installed-package-unresolvable' }])
  })
})
