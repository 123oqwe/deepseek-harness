/**
 * P0-01 C-stage contract for `scripts/release/baseline-fingerprint.mjs`
 * (`pnpm baseline:capture` / `pnpm baseline:verify`, not yet implemented —
 * that is P-stage). Every assertion below exercises the real subprocess
 * boundary: `node <repo>/scripts/release/baseline-fingerprint.mjs …` against
 * a throwaway git fixture, never a mock. The script does not exist yet, so
 * every test fails today on a genuine, on-topic result (nonzero exit / a
 * missing output file), not a module-resolution crash — `spawnSync` returns
 * the interpreter's "Cannot find module" failure as a normal result object.
 *
 * Contract decision recorded here for the P-stage implementer: the script
 * takes an explicit `--repo-root <path>` so it can capture/verify a target
 * checkout other than its own cwd, keeping this fixture isolated from the
 * real repository tree.
 */
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const scriptPath = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')

const specimen = JSON.parse(readFileSync(join(repoRoot, '.dsh/baseline.json'), 'utf8')) as Record<string, unknown>
const canonicalTopLevelKeys = Object.keys(specimen).sort()

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

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

interface Fixture {
  root: string
  gitSha: string
}

/** A minimal but structurally realistic checkout: workspace manifest, a bundle-row file, and protocol/event schema files, mirroring the real repo's shape without touching it. */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-baseline-fingerprint-'))
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
  const gitSha = git(root, ['rev-parse', 'HEAD'])
  return { root, gitSha }
}

function capture(root: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [scriptPath, 'capture', '--repo-root', root], { cwd: root, encoding: 'utf8' })
}

function verify(root: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [scriptPath, 'verify', '--repo-root', root], { cwd: root, encoding: 'utf8' })
}

describe('release/baseline-fingerprint contract (P0-01 C-stage)', () => {
  it('captures .dsh/baseline.json with the canonical field set the MUST clause requires', () => {
    const { root, gitSha } = makeFixture()
    const result = capture(root)
    expect(result.status, `capture stderr: ${result.stderr}`).toBe(0)
    const outPath = join(root, '.dsh/baseline.json')
    expect(existsSync(outPath), 'capture must write .dsh/baseline.json').toBe(true)
    const captured = JSON.parse(readFileSync(outPath, 'utf8')) as Record<string, unknown>
    expect(Object.keys(captured).sort()).toEqual(canonicalTopLevelKeys)
    expect(captured.gitSha).toBe(gitSha)
    expect(captured.workspacePackages).toEqual(['@fixture/alpha', '@fixture/beta'])
    expect(captured.defaultBundleRowIds).toEqual(['row-alpha', 'row-beta'])
    expect(typeof (captured.protocolSchemaHashes as Record<string, unknown>)['packages/sdk/protocol/src/types.ts']).toBe('string')
  })

  it('canonicalizes the captured output: sorted keys, LF-only, UTF-8 NFC, POSIX-relative paths, and no nondeterministic fields', () => {
    const { root } = makeFixture()
    const result = capture(root)
    expect(result.status, `capture stderr: ${result.stderr}`).toBe(0)
    const outPath = join(root, '.dsh/baseline.json')
    const raw = readFileSync(outPath, 'utf8')
    expect(raw.includes('\r')).toBe(false)
    expect(raw.normalize('NFC')).toBe(raw)
    const captured = JSON.parse(raw) as Record<string, unknown>
    expect(`${JSON.stringify(sortKeysDeep(captured), null, 2)}\n`).toBe(raw)
    for (const path of Object.keys(captured.protocolSchemaHashes as Record<string, unknown>)) {
      expect(path.includes('\\')).toBe(false)
      expect(path.startsWith('/')).toBe(false)
    }
    for (const forbiddenField of ['capturedAt', 'timestamp', 'os', 'platform', 'hostname']) {
      expect(Object.prototype.hasOwnProperty.call(captured, forbiddenField)).toBe(false)
    }
  })

  it('writes the audit SHA into both the machine file and docs/audit/baseline-fingerprint-<sha>.md', () => {
    const { root, gitSha } = makeFixture()
    const result = capture(root)
    expect(result.status, `capture stderr: ${result.stderr}`).toBe(0)
    const captured = JSON.parse(readFileSync(join(root, '.dsh/baseline.json'), 'utf8')) as Record<string, unknown>
    expect(captured.gitSha).toBe(gitSha)
    const docPath = join(root, `docs/audit/baseline-fingerprint-${gitSha}.md`)
    expect(existsSync(docPath), 'capture must also emit docs/audit/baseline-fingerprint-<sha>.md').toBe(true)
    expect(readFileSync(docPath, 'utf8')).toContain(gitSha)
  })

  it('verify exits 0 against an unmodified captured baseline', () => {
    const { root } = makeFixture()
    const captureResult = capture(root)
    expect(captureResult.status, `capture stderr: ${captureResult.stderr}`).toBe(0)
    const verifyResult = verify(root)
    expect(verifyResult.status, `verify stderr: ${verifyResult.stderr}`).toBe(0)
  })

  it('verify fails and names the minimal diff after a tracked bundle-row file drifts, and writes a rebase report', () => {
    const { root } = makeFixture()
    const captureResult = capture(root)
    expect(captureResult.status, `capture stderr: ${captureResult.stderr}`).toBe(0)
    write(root, 'packages/bundle/base/cordis.patch.yml', 'rows:\n  - id: row-alpha\n  - id: row-beta\n  - id: row-gamma\n')
    const verifyResult = verify(root)
    expect(verifyResult.status).not.toBe(0)
    const output = `${verifyResult.stdout}${verifyResult.stderr}`
    expect(output).toContain('packages/bundle/base/cordis.patch.yml')
    expect(existsSync(join(root, '.dsh/rebase-report.json')), 'a drift must produce a rebase report').toBe(true)
  })

  it('verify passes again once the drifted file is restored', () => {
    const { root } = makeFixture()
    const captureResult = capture(root)
    expect(captureResult.status, `capture stderr: ${captureResult.stderr}`).toBe(0)
    const bundlePath = 'packages/bundle/base/cordis.patch.yml'
    const original = readFileSync(join(root, bundlePath), 'utf8')
    write(root, bundlePath, `${original}  - id: row-gamma\n`)
    const drifted = verify(root)
    expect(drifted.status).not.toBe(0)
    write(root, bundlePath, original)
    const restored = verify(root)
    expect(restored.status, `verify stderr: ${restored.stderr}`).toBe(0)
  })
})

describe('release/baseline-fingerprint fault/tamper contract (P0-01 F-stage)', () => {
  it('verify fails and names the tampered SDK protocol types file', () => {
    const { root } = makeFixture()
    const captureResult = capture(root)
    expect(captureResult.status, `capture stderr: ${captureResult.stderr}`).toBe(0)
    write(root, 'packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n  tampered: true\n}\n')
    const verifyResult = verify(root)
    expect(verifyResult.status).not.toBe(0)
    const output = `${verifyResult.stdout}${verifyResult.stderr}`
    expect(output).toContain('packages/sdk/protocol/src/types.ts')
  })

  it('verify fails and names the tampered known-event-types file', () => {
    const { root } = makeFixture()
    const captureResult = capture(root)
    expect(captureResult.status, `capture stderr: ${captureResult.stderr}`).toBe(0)
    write(root, 'packages/core/session/src/known-event-types.ts', "export type KnownEventType = 'session.start' | 'session.tampered'\n")
    const verifyResult = verify(root)
    expect(verifyResult.status).not.toBe(0)
    const output = `${verifyResult.stdout}${verifyResult.stderr}`
    expect(output).toContain('packages/core/session/src/known-event-types.ts')
  })

  it('verify fails and names the tampered pnpm-lock.yaml', () => {
    const { root } = makeFixture()
    const captureResult = capture(root)
    expect(captureResult.status, `capture stderr: ${captureResult.stderr}`).toBe(0)
    write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages:\n  tampered: true\n")
    const verifyResult = verify(root)
    expect(verifyResult.status).not.toBe(0)
    const output = `${verifyResult.stdout}${verifyResult.stderr}`
    expect(output).toContain('pnpm-lock.yaml')
  })

  it('verify fails and names the drifted workspace package manifest', () => {
    const { root } = makeFixture()
    const captureResult = capture(root)
    expect(captureResult.status, `capture stderr: ${captureResult.stderr}`).toBe(0)
    write(root, 'packages/alpha/package.json', `${JSON.stringify({ name: '@fixture/alpha-renamed', version: '0.0.0', private: true }, null, 2)}\n`)
    const verifyResult = verify(root)
    expect(verifyResult.status).not.toBe(0)
    const output = `${verifyResult.stdout}${verifyResult.stderr}`
    expect(output).toContain('pnpm-workspace.yaml')
  })

  it('captures a fingerprint that never leaks the fixture checkout\'s absolute path or backslash-spelled paths anywhere in its content', () => {
    const { root } = makeFixture()
    const result = capture(root)
    expect(result.status, `capture stderr: ${result.stderr}`).toBe(0)
    const captured = JSON.parse(readFileSync(join(root, '.dsh/baseline.json'), 'utf8')) as Record<string, unknown>
    const serialized = JSON.stringify(captured)
    expect(serialized.includes(root), 'no field may embed the fixture checkout\'s absolute root path').toBe(false)

    const stringValues: string[] = []
    function collectStrings(value: unknown): void {
      if (typeof value === 'string') {
        stringValues.push(value)
        return
      }
      if (Array.isArray(value)) {
        for (const item of value) collectStrings(item)
        return
      }
      if (value !== null && typeof value === 'object') {
        for (const nested of Object.values(value)) collectStrings(nested)
      }
    }
    collectStrings(captured)
    for (const value of stringValues) {
      expect(value.includes('\\'), `no captured string value may contain a backslash: ${value}`).toBe(false)
      expect(/^[A-Za-z]:/.test(value), `no captured string value may be a Windows drive-letter path: ${value}`).toBe(false)
    }

    for (const path of Object.keys(captured.protocolSchemaHashes as Record<string, unknown>)) {
      expect(path.startsWith('/'), `protocolSchemaHashes keys must be repo-relative, not absolute: ${path}`).toBe(false)
    }
  })
})

describe('release/baseline-fingerprint npm-script contract (P0-01 P-stage)', () => {
  it('wires baseline:capture/baseline:verify in package.json to the real script, and pnpm run actually executes it', () => {
    const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(rootPackageJson.scripts?.['baseline:capture']).toBe('node scripts/release/baseline-fingerprint.mjs capture')
    expect(rootPackageJson.scripts?.['baseline:verify']).toBe('node scripts/release/baseline-fingerprint.mjs verify')

    const { root } = makeFixture()
    const fixturePackageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
    write(
      root,
      'package.json',
      `${JSON.stringify(
        {
          ...fixturePackageJson,
          scripts: {
            'baseline:capture': `node ${scriptPath} capture`,
            'baseline:verify': `node ${scriptPath} verify`,
          },
        },
        null,
        2,
      )}\n`,
    )

    const captureResult = spawnSync('pnpm', ['run', 'baseline:capture'], { cwd: root, encoding: 'utf8' })
    expect(captureResult.status, `pnpm run baseline:capture stderr: ${captureResult.stderr}`).toBe(0)
    expect(existsSync(join(root, '.dsh/baseline.json')), 'pnpm run baseline:capture must write .dsh/baseline.json').toBe(true)

    const verifyResult = spawnSync('pnpm', ['run', 'baseline:verify'], { cwd: root, encoding: 'utf8' })
    expect(verifyResult.status, `pnpm run baseline:verify stderr: ${verifyResult.stderr}`).toBe(0)
  })
})
