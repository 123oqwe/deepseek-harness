/**
 * P0-07 U-stage composition contract: `package.json` wires `pnpm evidence:collect`/
 * `pnpm evidence:verify` to the real P-stage scripts (`scripts/release/collect-evidence.mjs`,
 * `scripts/release/verify-evidence.mjs`), mirroring the established
 * `baseline:capture`/`baseline:verify` npm-script contract in
 * `tests/release/baseline-fingerprint.spec.ts` (P0-01): a fixture `package.json` points
 * the same script names at the real scripts, and `pnpm run` is invoked as a genuine
 * subprocess so a passing test proves pnpm's script resolution, not just a JSON string
 * equality assertion. `docs/testing.md` and `AGENTS.md` document the mechanism and the
 * acceptance[2] reporting convention (cite the evidence package's real path and its
 * `accepted` status when reporting a gate result).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const collectScriptPath = join(repoRoot, 'scripts/release/collect-evidence.mjs')
const verifyScriptPath = join(repoRoot, 'scripts/release/verify-evidence.mjs')
const baselineScriptPath = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')

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

describe('release/evidence-package npm-script contract (Epic P0-07 U-stage)', () => {
  it('wires evidence:collect/evidence:verify in the real package.json to the real P-stage scripts', () => {
    const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(rootPackageJson.scripts?.['evidence:collect']).toBe('node scripts/release/collect-evidence.mjs')
    expect(rootPackageJson.scripts?.['evidence:verify']).toBe('node scripts/release/verify-evidence.mjs')
  })

  it('pnpm run evidence:collect/evidence:verify actually execute the real scripts end-to-end against a throwaway fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-evidence-npm-script-'))
    fixtureRoots.push(root)
    git(root, ['init', '--initial-branch=main'])
    git(root, ['config', 'user.email', 'evidence-npm-script-fixture@example.com'])
    git(root, ['config', 'user.name', 'Evidence NPM Script Fixture'])
    git(root, ['config', 'commit.gpgsign', 'false'])
    write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
    write(root, 'packages/bundle/base/cordis.patch.yml', 'rows:\n  - id: row-alpha\n')
    write(root, 'packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n}\n')
    write(root, 'packages/core/session/src/known-event-types.ts', "export type KnownEventType = 'session.start'\n")
    write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages: {}\n")
    write(
      root,
      'package.json',
      `${JSON.stringify(
        {
          name: '@fixture/root',
          private: true,
          packageManager: 'pnpm@11.7.0',
          scripts: {
            'baseline:capture': `node ${baselineScriptPath} capture`,
            'evidence:collect': `node ${collectScriptPath}`,
            'evidence:verify': `node ${verifyScriptPath}`,
          },
        },
        null,
        2,
      )}\n`,
    )
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'fixture baseline'])
    const baseSha = git(root, ['rev-parse', 'HEAD'])
    // `collect-evidence init` requires a real captured baseline whose gitSha equals the
    // current HEAD, so a real second commit must land, and `baseline:capture` must run,
    // before `init` -- same shape as the P-stage contract's own fixture. Capture runs
    // through `pnpm run` (not a direct node invocation) so pnpm's own first-touch of
    // `pnpm-lock.yaml` (its content settles on pnpm's first invocation in a fresh
    // checkout) happens before the baseline is captured, not after -- otherwise
    // `evidence:collect init`'s own first `pnpm run` would drift the just-captured
    // baseline's `pnpmLockHash`, exactly as `baseline-fingerprint.spec.ts`'s own
    // npm-script contract test captures AND verifies through `pnpm run` for the same
    // reason.
    write(root, 'lib/index.js', "console.log('build output')\n")
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'add build output'])

    const captureResult = spawnSync('pnpm', ['run', 'baseline:capture', '--repo-root', root], { cwd: root, encoding: 'utf8' })
    expect(captureResult.status, `pnpm run baseline:capture stderr: ${captureResult.stderr}`).toBe(0)

    const initResult = spawnSync(
      'pnpm',
      ['run', 'evidence:collect', 'init', '--repo-root', root, '--base-sha', baseSha, '--required-gate', 'smoke'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(initResult.status, `pnpm run evidence:collect init stderr: ${initResult.stderr}`).toBe(0)

    const runResult = spawnSync(
      'pnpm',
      ['run', 'evidence:collect', 'run', '--repo-root', root, '--gate-id', 'smoke', '--required', '--', process.execPath, '-e', "console.log('ok')"],
      { cwd: root, encoding: 'utf8' },
    )
    expect(runResult.status, `pnpm run evidence:collect run stderr: ${runResult.stderr}`).toBe(0)

    const evidencePath = join(root, '.dsh/evidence/evidence.json')
    expect(existsSync(evidencePath), 'pnpm run evidence:collect must write .dsh/evidence/evidence.json').toBe(true)

    const verifyResult = spawnSync(
      'pnpm',
      ['run', 'evidence:verify', '--repo-root', root, '--evidence', '.dsh/evidence/evidence.json'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(verifyResult.status, `pnpm run evidence:verify stderr: ${verifyResult.stderr}`).toBe(0)
  }, 30_000)
})

describe('P0-07 U-stage documentation (release evidence package)', () => {
  it('docs/testing.md documents the pnpm evidence:collect/evidence:verify commands', () => {
    const testingMd = readFileSync(join(repoRoot, 'docs/testing.md'), 'utf8')
    expect(testingMd).toContain('pnpm evidence:collect')
    expect(testingMd).toContain('pnpm evidence:verify')
  })

  it('AGENTS.md states the evidence-gate reporting convention (acceptance[2]: cite package path and accepted status)', () => {
    const agentsMd = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('Evidence-gate reporting')
    expect(agentsMd).toMatch(/`accepted`\s*status/)
  })
})
