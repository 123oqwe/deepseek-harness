/**
 * A throwaway checkout for P0-01's fingerprint cases, and the fingerprint CLI
 * run against it through its real subprocess boundary.
 *
 * The checkout mirrors the one `baseline-fingerprint.spec.ts` builds: a
 * workspace manifest with two packages, the default bundle-row file, the two
 * protocol and event schema files and a lockfile, committed once.
 * @module tests/release/fingerprint-fixture
 */

import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/** The fingerprint CLI the cases run. */
export const FINGERPRINT_SCRIPT = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')

/**
 * Run git in a checkout.
 * @param cwd - the checkout.
 * @param args - git's arguments.
 * @returns its trimmed standard output.
 */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).trim()
}

/**
 * Write one file under a root, creating its directory.
 * @param root - the checkout.
 * @param relPath - the file's path under it.
 * @param content - the file's content.
 */
export function write(root: string, relPath: string, content: string): void {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/**
 * Create and commit a fresh checkout. The caller removes it.
 * @returns the checkout's root.
 */
export function makeFingerprintFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fingerprint-'))
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

/**
 * Run `baseline-fingerprint.mjs capture` or `verify` against a checkout.
 * @param command - which subcommand.
 * @param root - the checkout, as passed to `--repo-root`.
 * @param env - variables layered over this process's environment.
 * @returns the finished subprocess.
 */
export function runFingerprint(
  command: 'capture' | 'verify',
  root: string,
  env: Readonly<Record<string, string>> = {},
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [FINGERPRINT_SCRIPT, command, '--repo-root', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}
