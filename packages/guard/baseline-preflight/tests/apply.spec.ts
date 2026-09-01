/**
 * Direct-call branch coverage for `apply` (the real end-to-end boot-abort
 * path is `tests/first100/fixtures/P0-01.composition.spec.ts`, which drives
 * this plugin through a real Loader composition and process boot). These
 * cases exercise the branches that composition spec's two Loader-smoke
 * scenarios do not: no captured baseline at all, and the real no-drift
 * pass-through (distinct from "boots clean", which only proves the process
 * exits 0 and never inspects `apply`'s own resolution directly).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const scriptPath = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')
const bundleRowsPath = 'packages/bundle/base/cordis.patch.yml'

// `apply`'s single `_ctx` parameter is declared only for the Cordis plugin
// `apply(ctx, config)` shape and is never read.
const unusedCtx = {} as Context

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

/** A minimal captured-baseline fixture, matching `tests/release/baseline-fingerprint.spec.ts`'s shape. */
function makeCapturedFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-baseline-preflight-unit-'))
  fixtureRoots.push(root)
  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'baseline-preflight-unit@example.com'])
  git(root, ['config', 'user.name', 'Baseline Preflight Unit'])
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
  execFileSync(process.execPath, [scriptPath, 'capture', '--repo-root', root], { encoding: 'utf8' })
  return root
}

describe('baseline-preflight apply', () => {
  it('no-ops when the checkout has no captured baseline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-baseline-preflight-uncaptured-'))
    fixtureRoots.push(root)
    await expect(apply(unusedCtx, { repoRoot: root })).resolves.toBeUndefined()
  })

  it('resolves without throwing against an unmodified captured baseline', async () => {
    const root = makeCapturedFixture()
    await expect(apply(unusedCtx, { repoRoot: root })).resolves.toBeUndefined()
  })

  it('throws naming the drifted path when the fixture is tampered after capture', async () => {
    const root = makeCapturedFixture()
    write(root, bundleRowsPath, 'rows:\n  - id: row-alpha\n  - id: row-beta\n')
    await expect(apply(unusedCtx, { repoRoot: root })).rejects.toThrow(
      new RegExp(`baseline-preflight: checkout has drifted from its captured baseline[\\s\\S]*${bundleRowsPath.replace(/\//g, '\\/')}`),
    )
  })
})
