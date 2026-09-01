/**
 * P0-01 U-stage composition contract: `@deepseek-ai/dsh-baseline-preflight`
 * mounted through a real Loader composition and booted by
 * `@deepseek-ai/dsh-app-boot` (`tests/first100/fixtures/loader/baseline-preflight/`).
 * A clean fixture proves a normal boot passes through untouched; a fixture
 * tampered after capture proves `apply` genuinely aborts startup on drift
 * (a real observable effect per B7②, not a no-op registration) — mirroring
 * the throwaway git fixtures in `tests/release/baseline-fingerprint.spec.ts`
 * (P0-01 C/F-stage), but driven end-to-end through the real boot path this
 * plugin gates instead of the standalone CLI.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const scriptPath = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')
const binScript = fileURLToPath(new URL('./loader/baseline-preflight/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./loader/baseline-preflight/cordis.yml', import.meta.url))
const tsconfigPath = join(repoRoot, 'tsconfig.json')

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
  }).trim()
}

function write(root: string, relPath: string, content: string): void {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

const bundleRowsPath = 'packages/bundle/base/cordis.patch.yml'

/**
 * A minimal but structurally realistic checkout with a real captured
 * baseline: same fixture shape as the C-stage `baseline-fingerprint.spec.ts`
 * contract (workspace manifest, one bundle-row file, protocol/event schema
 * files, a lockfile), plus a real `pnpm baseline:capture` run against it.
 */
function makeCapturedFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-baseline-preflight-composition-'))
  fixtureRoots.push(root)
  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'baseline-preflight-fixture@example.com'])
  git(root, ['config', 'user.name', 'Baseline Preflight Fixture'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  write(root, 'package.json', `${JSON.stringify({ name: '@fixture/root', private: true, packageManager: 'pnpm@11.7.0' }, null, 2)}\n`)
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write(root, 'packages/alpha/package.json', `${JSON.stringify({ name: '@fixture/alpha', version: '0.0.0', private: true }, null, 2)}\n`)
  write(root, bundleRowsPath, 'rows:\n  - id: row-alpha\n')
  write(root, 'packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n}\n')
  write(root, 'packages/core/session/src/known-event-types.ts', "export type KnownEventType = 'session.start'\n")
  write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages: {}\n")
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'fixture baseline'])
  // execFileSync throws on a nonzero exit, so a failed capture fails the test
  // immediately with the script's own diagnostic rather than silently
  // producing an uncaptured fixture.
  execFileSync(process.execPath, [scriptPath, 'capture', '--repo-root', root], { encoding: 'utf8' })
  return root
}

describe('P0-01 baseline-preflight composition (U-stage)', () => {
  it('boots a clean fixture normally through the real Loader composition', async () => {
    const root = makeCapturedFixture()
    const result = await runLoaderSmoke({
      label: 'baseline-preflight clean boot',
      tempDirPrefix: 'baseline-preflight-clean-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      env: { BASELINE_PREFLIGHT_REPO_ROOT: root },
    })
    expect(result.stderr).not.toContain('baseline-preflight')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('aborts startup with the drifted path when the fixture is tampered after capture', async () => {
    const root = makeCapturedFixture()
    write(root, bundleRowsPath, 'rows:\n  - id: row-alpha\n  - id: row-beta\n')
    // `expectedExitCode: 1` declares the designed failure surface: the smoke
    // resolves (rather than rejecting) only because the process exits with
    // exactly this code, and rejects on any other outcome, including a clean
    // exit — the B7② "real observable effect" bar this fixture exists to prove.
    const failed = await runLoaderSmoke({
      label: 'baseline-preflight drifted boot',
      tempDirPrefix: 'baseline-preflight-drifted-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      env: { BASELINE_PREFLIGHT_REPO_ROOT: root },
      expectedExitCode: 1,
    })
    expect(failed.stderr).toContain('baseline-preflight: checkout has drifted from its captured baseline')
    expect(failed.stderr).toContain(bundleRowsPath)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
