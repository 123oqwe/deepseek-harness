/**
 * A-607 red first (P0-01 must[2], for B-712): a NEW commit that changes nothing
 * on the architecture/protocol-critical surface must leave `pnpm baseline:verify`
 * passing (exit 0). Today it does not: `diffCapture` compares the captured
 * `gitSha` under the path `HEAD` (baseline-fingerprint.mjs — `addSimple('HEAD',
 * 'gitSha')`), so ANY new commit changes `gitSha` and `verify` reports drift and
 * exits 1, even when no fingerprinted field moved. RED today; B-712 is the fix.
 *
 * The case isolates HEAD-vs-content on a throwaway mini-repo so nothing depends
 * on this checkout's own history: it seeds only the files `captureFields` reads
 * (the workspace manifest, the root manifest, the base bundle patch, the lockfile,
 * the protocol source dir, and the event-schema file), commits them (A), captures
 * the baseline, then verifies at the SAME commit (a guard that the capture is
 * deterministic — nothing but `gitSha` can move). It then makes commit B that
 * changes ONLY a non-fingerprint file and verifies again: today that reports
 * drift and exits 1 purely on `gitSha`.
 *
 * `./loader/...` is not used; the case drives the shipped `scripts/release/
 * baseline-fingerprint.mjs` CLI (`capture` / `verify --repo-root`) over the
 * mini-repo via `node`, the same entry `pnpm baseline:capture|verify` runs.
 * §21.4: the fix (B-712) is not read. Sub-case ③ (the main job verifying the
 * committed baseline before capture) is a workflow-ordering change that rides
 * B-712's yml, not this vitest fixture.
 * @module tests/first100/fixtures/P0-01.baseline-nonkey-commit.composition
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const fingerprintScript = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')
/** Deadline for one capture/verify run. */
const RUN_TIMEOUT_MS = 60_000

/** Run one `git` command in the mini-repo. */
function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

/** Run the shipped baseline-fingerprint CLI over the mini-repo. */
function fingerprint(repo: string, subcommand: 'capture' | 'verify'): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [fingerprintScript, subcommand, '--repo-root', repo], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Seed only the files `captureFields` reads, so `capture` succeeds on a mini-repo. */
function seedFingerprintInputs(repo: string): void {
  writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages: []\n')
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'a607-mini', version: '0.0.0', engines: { node: '^22.19' }, packageManager: 'pnpm@9.0.0' }, undefined, 2)}\n`)
  writeFileSync(join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  mkdirSync(join(repo, 'packages/bundle/base'), { recursive: true })
  writeFileSync(join(repo, 'packages/bundle/base/cordis.patch.yml'), '[]\n')
  mkdirSync(join(repo, 'packages/sdk/protocol/src'), { recursive: true })
  mkdirSync(join(repo, 'packages/core/session/src'), { recursive: true })
  writeFileSync(join(repo, 'packages/core/session/src/known-event-types.ts'), 'export const A607_MINI = true\n')
  // A non-fingerprint file: changing it moves HEAD but no captured field.
  writeFileSync(join(repo, 'notes.txt'), 'original\n')
}

const roots: string[] = []
let captureStatus: number | null = null
let verifyCleanStatus: number | null = null
let verifyAfterCommitStatus: number | null = null
let verifyAfterCommitText = ''
let verifyKeyChangeStatus: number | null = null
let verifyKeyChangeText = ''
let setupError: string | undefined

beforeAll(async () => {
  try {
    const repo = await mkdtemp(join(tmpdir(), 'p0-01-nonkey-'))
    roots.push(repo)
    git(repo, 'init', '-q')
    git(repo, 'config', 'user.email', 'a607@example.test')
    git(repo, 'config', 'user.name', 'a607')
    git(repo, 'config', 'commit.gpgsign', 'false')
    seedFingerprintInputs(repo)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'A: fingerprint inputs')

    captureStatus = fingerprint(repo, 'capture').status
    // Guard: verifying at the SAME commit is clean, so the only thing commit B
    // below changes is HEAD — not a non-deterministic capture.
    verifyCleanStatus = fingerprint(repo, 'verify').status

    // Commit B changes ONLY a non-fingerprint file. Stage just that file so the
    // capture's own `.dsh`/`docs/audit` outputs stay out of the commit.
    writeFileSync(join(repo, 'notes.txt'), 'changed\n')
    git(repo, 'add', 'notes.txt')
    git(repo, 'commit', '-q', '-m', 'B: a non-fingerprint change')

    const verifyAfter = fingerprint(repo, 'verify')
    verifyAfterCommitStatus = verifyAfter.status
    verifyAfterCommitText = `${verifyAfter.stdout}\n${verifyAfter.stderr}`.slice(-1000)

    // Sub-case 2 (green control): a commit that DOES change a fingerprinted
    // surface must still be reported, so B-712's fix for sub-case 1 cannot
    // over-correct into "verify never drifts". A fresh mini-repo, captured, then
    // a commit changing the protocol event-schema file.
    const repo2 = await mkdtemp(join(tmpdir(), 'p0-01-keychange-'))
    roots.push(repo2)
    git(repo2, 'init', '-q')
    git(repo2, 'config', 'user.email', 'a607@example.test')
    git(repo2, 'config', 'user.name', 'a607')
    git(repo2, 'config', 'commit.gpgsign', 'false')
    seedFingerprintInputs(repo2)
    git(repo2, 'add', '-A')
    git(repo2, 'commit', '-q', '-m', 'A: fingerprint inputs')
    fingerprint(repo2, 'capture')
    writeFileSync(join(repo2, 'packages/core/session/src/known-event-types.ts'), 'export const A607_MINI = false\n')
    git(repo2, 'add', '-A')
    git(repo2, 'commit', '-q', '-m', 'B: change the protocol event-schema file')
    const verifyKeyChange = fingerprint(repo2, 'verify')
    verifyKeyChangeStatus = verifyKeyChange.status
    verifyKeyChangeText = `${verifyKeyChange.stdout}\n${verifyKeyChange.stderr}`.slice(-1000)
  } catch (error: unknown) {
    setupError = error instanceof Error ? error.message : String(error)
  }
}, 4 * RUN_TIMEOUT_MS)

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

describe('P0-01 must[2] (A-607, B-712 red first): a commit that touches no fingerprinted surface leaves baseline:verify passing', () => {
  it('a non-fingerprint commit verifies clean (today it reports gitSha drift and exits nonzero — RED)', () => {
    if (setupError !== undefined) throw new Error(setupError)
    const context = JSON.stringify({ captureStatus, verifyCleanStatus, verifyAfterCommitStatus, verifyAfterCommitText })
    // Guards: the mini-repo captured, and verifying at the same commit is clean,
    // so the only difference commit B introduces is HEAD. A failure here means
    // the seeding is wrong, not that the subject passed.
    expect({ captureStatus, verifyCleanStatus }, context).toEqual({ captureStatus: 0, verifyCleanStatus: 0 })
    // must[2]: a commit that moved no fingerprinted field verifies clean. RED
    // today — `diffCapture` compares `gitSha` under `HEAD`, so the new commit
    // alone reports drift and `verify` exits nonzero.
    expect(verifyAfterCommitStatus, context).toBe(0)
  })

  it('a commit that changes a fingerprinted surface still verifies dirty and names the field (green control, before and after B-712)', () => {
    if (setupError !== undefined) throw new Error(setupError)
    const context = JSON.stringify({ verifyKeyChangeStatus, verifyKeyChangeText })
    // A real content change on a fingerprinted surface (the protocol event-schema
    // file) is detected and NAMED, so the fix for sub-case 1 does not turn verify
    // into a no-op. GREEN today and after B-712: a non-key commit (sub-case 1)
    // stops drifting, a key-surface change (this) keeps drifting and names itself.
    expect(verifyKeyChangeStatus, context).toBe(1)
    expect(verifyKeyChangeText, context).toContain('known-event-types.ts')
  })
})
