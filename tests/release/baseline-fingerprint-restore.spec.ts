/**
 * P0-01 acceptance[2] — "restoring the file makes verify pass again" — for
 * every recorded change class (BLOCKED-305, A-534). The C-stage spec
 * (`baseline-fingerprint.spec.ts`) already carries the bundle-row restore case;
 * this file adds one restore case per remaining class the fault/tamper contract
 * detects: the SDK protocol types file, the known-event-types file,
 * `pnpm-lock.yaml`, and a workspace package manifest.
 *
 * Each case exercises the real subprocess boundary against a throwaway git
 * fixture, mirroring the C/F-stage harness so this file touches no frozen
 * spec. It captures, tampers the class's file, confirms verify fails, restores
 * the original bytes, and confirms verify passes again. The product's detection
 * is symmetric after B-626, so these are green evidence rather than red-first;
 * a class that failed to restore would be a defect raised to the delegate.
 */
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const scriptPath = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).trim()
}

function write(root: string, relPath: string, content: string): void {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** A minimal but structurally realistic checkout, matching the C/F-stage fixture so the same classes are recorded. */
function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-baseline-fingerprint-restore-'))
  fixtureRoots.push(root)
  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'baseline-fixture@example.com'])
  git(root, ['config', 'user.name', 'Baseline Fixture'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  write(root, 'package.json', `${JSON.stringify({ name: '@fixture/root', private: true, packageManager: 'pnpm@11.7.0' }, null, 2)}\n`)
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write(root, 'packages/alpha/package.json', `${JSON.stringify({ name: '@fixture/alpha', version: '0.0.0', private: true }, null, 2)}\n`)
  write(root, 'packages/beta/package.json', `${JSON.stringify({ name: '@fixture/beta', version: '0.0.0', private: true }, null, 2)}\n`)
  write(root, 'packages/bundle/base/cordis.patch.yml', 'rows:\n  - id: row-alpha\n  - id: row-beta\n')
  write(root, 'packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n}\n')
  write(root, 'packages/core/session/src/known-event-types.ts', "export type KnownEventType = 'session.start'\n")
  write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages: {}\n")
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'fixture baseline'])
  return root
}

function capture(root: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [scriptPath, 'capture', '--repo-root', root], { cwd: root, encoding: 'utf8' })
}

function verify(root: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [scriptPath, 'verify', '--repo-root', root], { cwd: root, encoding: 'utf8' })
}

/**
 * Capture, tamper one file, confirm verify fails, restore the original bytes,
 * and confirm verify passes again.
 * @param relPath - the class's file to tamper and restore.
 * @param tampered - the drifted content that must make verify fail.
 */
function expectRestorePasses(relPath: string, tampered: string): void {
  const root = makeFixture()
  const captureResult = capture(root)
  expect(captureResult.status, `capture stderr: ${captureResult.stderr}`).toBe(0)
  const original = readFileSync(join(root, relPath), 'utf8')
  write(root, relPath, tampered)
  expect(verify(root).status, 'a tampered file must make verify fail').not.toBe(0)
  write(root, relPath, original)
  const restored = verify(root)
  expect(restored.status, `verify stderr: ${restored.stderr}`).toBe(0)
}

describe('release/baseline-fingerprint restore contract, per class (P0-01 acceptance[2])', () => {
  it('verify passes again once a tampered SDK protocol types file is restored', () => {
    expectRestorePasses('packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n  tampered: true\n}\n')
  })

  it('verify passes again once a tampered known-event-types file is restored', () => {
    expectRestorePasses('packages/core/session/src/known-event-types.ts', "export type KnownEventType = 'session.start' | 'session.tampered'\n")
  })

  it('verify passes again once a tampered pnpm-lock.yaml is restored', () => {
    expectRestorePasses('pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages:\n  tampered: true\n")
  })

  it('verify passes again once a drifted workspace package manifest is restored', () => {
    expectRestorePasses('packages/alpha/package.json', `${JSON.stringify({ name: '@fixture/alpha-renamed', version: '0.0.0', private: true }, null, 2)}\n`)
  })
})
