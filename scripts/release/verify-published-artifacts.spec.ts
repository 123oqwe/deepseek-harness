/** BLOCKED-362: the publish jobs' check of downloaded tarballs against the release evidence package. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./verify-published-artifacts.mjs', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** The two tarballs every fixture packs, by repository-relative path. */
const TARBALLS: Readonly<Record<string, string>> = {
  'dist/npm/a-1.0.0.tgz': 'a bytes',
  'dist/npm/b-1.0.0.tgz': 'b bytes',
}

/**
 * The hex sha256 of some bytes.
 * @param bytes - the bytes.
 * @returns the digest.
 */
function sha256(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * A repository holding the packed tarballs under `dist/npm` and, under
 * `dist/evidence`, an evidence package that records them.
 * @param accepted - the package's `accepted` field.
 * @returns the repository root and the evidence package's sha256.
 */
function fixture(accepted: unknown = true): { root: string; evidenceSha256: string } {
  const root = mkdtempSync(join(tmpdir(), 'verify-published-artifacts-'))
  roots.push(root)
  mkdirSync(join(root, 'dist', 'npm'), { recursive: true })
  mkdirSync(join(root, 'dist', 'evidence'), { recursive: true })
  for (const [path, content] of Object.entries(TARBALLS)) writeFileSync(join(root, path), content)
  const evidence = JSON.stringify({
    accepted,
    requiredBuildArtifacts: Object.fromEntries(Object.entries(TARBALLS).map(([path, content]) => [path, sha256(content)])),
  })
  writeFileSync(join(root, 'dist', 'evidence', 'evidence.json'), evidence)
  return { root, evidenceSha256: sha256(evidence) }
}

/**
 * Run the script against a repository.
 * @param root - the repository root.
 * @param args - the arguments after `--repo-root`.
 * @returns the exit status and the combined output.
 */
function run(root: string, args: readonly string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [script, '--repo-root', root, ...args], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

/**
 * Run the script as a publish job does.
 * @param root - the repository root.
 * @param evidenceSha256 - the digest the pack job reported.
 * @returns the exit status and the combined output.
 */
function verify(root: string, evidenceSha256: string): { status: number | null; output: string } {
  return run(root, ['--evidence', 'dist/evidence/evidence.json', '--evidence-sha256', evidenceSha256, '--dir', 'dist/npm'])
}

describe('verify-published-artifacts (BLOCKED-362)', () => {
  it('admits exactly the tarballs the evidence package records, byte for byte', () => {
    const { root, evidenceSha256 } = fixture()
    expect(verify(root, evidenceSha256)).toEqual({ status: 0, output: 'verify-published-artifacts: every file under dist/npm matches dist/evidence/evidence.json\n' })
  })

  it('refuses a tarball whose bytes changed after the pack job recorded them', () => {
    const { root, evidenceSha256 } = fixture()
    writeFileSync(join(root, 'dist/npm/a-1.0.0.tgz'), 'substituted bytes')
    const result = verify(root, evidenceSha256)
    expect(result.status).toBe(1)
    expect(result.output).toContain('dist/npm/a-1.0.0.tgz does not match the evidence package')
  })

  it('refuses a downloaded file the evidence package does not record', () => {
    const { root, evidenceSha256 } = fixture()
    writeFileSync(join(root, 'dist/npm/c-1.0.0.tgz'), 'c bytes')
    const result = verify(root, evidenceSha256)
    expect(result.status).toBe(1)
    expect(result.output).toContain('dist/npm/c-1.0.0.tgz was downloaded but the evidence package does not record it')
  })

  it('refuses when a recorded tarball was not downloaded', () => {
    const { root, evidenceSha256 } = fixture()
    unlinkSync(join(root, 'dist/npm/b-1.0.0.tgz'))
    const result = verify(root, evidenceSha256)
    expect(result.status).toBe(1)
    expect(result.output).toContain('dist/npm/b-1.0.0.tgz is recorded in the evidence package but was not downloaded')
  })

  it('refuses an evidence package that does not record accepted: true', () => {
    const { root, evidenceSha256 } = fixture(false)
    const result = verify(root, evidenceSha256)
    expect(result.status).toBe(1)
    expect(result.output).toContain('the evidence package records accepted=false, not true')
  })

  it('refuses an evidence package other than the one the pack job reported', () => {
    const { root } = fixture()
    const result = verify(root, sha256('another package'))
    expect(result.status).toBe(1)
    expect(result.output).toContain('the evidence package is not the one the pack job reported')
  })

  it('refuses an unknown flag, a flag without a value, a repeated flag, and a missing required flag', () => {
    const { root, evidenceSha256 } = fixture()
    expect(run(root, ['--evidence', 'dist/evidence/evidence.json', '--dirs', 'dist/npm']).output).toContain('unknown argument "--dirs"')
    expect(run(root, ['--evidence']).output).toContain('--evidence requires a value')
    expect(run(root, ['--dir', 'dist/npm', '--dir', 'dist/npm']).output).toContain('--dir is given twice')
    const missing = run(root, ['--evidence', 'dist/evidence/evidence.json', '--dir', 'dist/npm'])
    expect(missing.status).not.toBe(0)
    expect(missing.output).toContain('--evidence, --evidence-sha256 and --dir are required')
    expect(verify(root, evidenceSha256).status).toBe(0)
  })
})
