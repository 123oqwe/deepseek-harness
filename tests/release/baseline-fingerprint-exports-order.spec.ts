/**
 * P0-01 blind-review 1-2 (A-594): the baseline fingerprint must notice a
 * reordering of a package manifest's `exports` conditions, because that order
 * is load-bearing — Node resolves conditions top to bottom, so `types` before
 * `default` and `default` before `types` resolve differently, yet both describe
 * the same keys. `baseline-fingerprint.mjs` hashes each manifest field through
 * `canonicalJson`/`sortKeysDeep` (scripts/release/baseline-fingerprint.mjs:68-85,
 * :149-158), which sorts object keys deep before hashing, so the two orderings
 * hash alike and `verify` reports no drift.
 *
 * Red first for B-710 (§21.4: the fix is not read). Each assertion exercises the
 * real subprocess (`node …/baseline-fingerprint.mjs capture|verify --repo-root
 * <fixture>`) against a throwaway git checkout, as
 * tests/release/baseline-fingerprint.spec.ts does. A fixture package declares an
 * order-sensitive `exports`; after capture, the two conditions are swapped in
 * place (same keys, new order) and `verify` must fail and name that manifest's
 * `exports`. Today it exits 0 and reports no drift — RED; B-710 preserves the
 * order of order-semantic fields and detects it.
 */
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const scriptPath = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')

/** The manifest whose exports order is swapped, relative to the fixture root. */
const ALPHA_MANIFEST = 'packages/alpha/package.json'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).trim()
}

function write(root: string, relPath: string, content: string): void {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** The alpha manifest with its `exports` conditions in the given order. */
function alphaManifest(order: readonly ['types' | 'default', 'types' | 'default']): string {
  const conditions: Record<string, string> = {}
  for (const condition of order) conditions[condition] = condition === 'types' ? './index.d.ts' : './index.js'
  return `${JSON.stringify({ name: '@fixture/alpha', version: '0.0.0', private: true, exports: { '.': conditions } }, null, 2)}\n`
}

/**
 * A structurally realistic checkout, mirroring tests/release/baseline-fingerprint.spec.ts,
 * whose alpha package carries an order-sensitive `exports` (types before default).
 * @returns the fixture root.
 */
function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-baseline-exports-'))
  fixtureRoots.push(root)
  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'baseline-fixture@example.com'])
  git(root, ['config', 'user.name', 'Baseline Fixture'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  write(root, 'package.json', `${JSON.stringify({ name: '@fixture/root', private: true, packageManager: 'pnpm@11.7.0' }, null, 2)}\n`)
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write(root, ALPHA_MANIFEST, alphaManifest(['types', 'default']))
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

describe('release/baseline-fingerprint: an exports-condition reorder is a drift (P0-01 blind 1-2, red first for B-710)', () => {
  it('verify fails and names the manifest exports after its exports conditions are reordered (today it reports no drift — RED)', () => {
    const root = makeFixture()
    const captured = capture(root)
    expect(captured.status, `capture stderr: ${captured.stderr}`).toBe(0)
    // Swap the two conditions in place: same keys, reversed order. Node resolves
    // conditions top to bottom, so default-before-types resolves the runtime
    // entry where types was meant to win — a real, load-bearing change. The
    // working tree is left uncommitted, so gitSha is unchanged and only the
    // exports field could differ.
    write(root, ALPHA_MANIFEST, alphaManifest(['default', 'types']))
    const result = verify(root)
    const detail = `exit ${String(result.status)}; stdout: ${result.stdout}; stderr: ${result.stderr}`
    // B-710 preserves the order of order-semantic fields, so verify detects the
    // reorder as drift and names the manifest's exports. Today the deep key sort
    // makes both orders hash alike, so verify exits 0 and reports no drift.
    expect(result.status, detail).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`, detail).toContain(ALPHA_MANIFEST)
    expect(`${result.stdout}${result.stderr}`, detail).toContain('exports')
  })

  it('control: verify exits 0 against the unmodified captured baseline', () => {
    const root = makeFixture()
    const captured = capture(root)
    expect(captured.status, `capture stderr: ${captured.stderr}`).toBe(0)
    const result = verify(root)
    // Green today and after: the harness captures and verifies a clean tree, so
    // the drift above is the exports reorder and not a broken fixture.
    expect(result.status, `exit ${String(result.status)}; stderr: ${result.stderr}`).toBe(0)
  })
})
