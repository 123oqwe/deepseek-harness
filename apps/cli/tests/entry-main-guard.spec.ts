/**
 * P0-01 / BLOCKED-351 (closing condition 1): a shipped entry script does its
 * work when it is the process entry even on a Node that does not define
 * `import.meta.main`. Today the entries guard their main block with
 * `if (import.meta.main)` (apps/cli/src/bin.ts, scripts/release/
 * baseline-fingerprint.mjs), which is `undefined` on Node 24.0.0 even for the
 * main module, so `dsh` and `baseline:verify` exit 0 and do nothing — a
 * fail-open that breaks must[1] ("verify before any execution batch; stop on
 * upstream drift").
 *
 * Red first for B-688. §21.4: the fix is not read. These cases reproduce the
 * failing condition deterministically on ANY Node: a wrapper sets
 * `process.argv[1]` to the entry and then IMPORTS the entry, so the entry runs
 * with `import.meta.main` false (it is imported, not the main) while `argv[1]`
 * names it — exactly the Node-24 shape. Today the guarded block is skipped and
 * the entry does nothing; B-688's version-independent guard
 * (`resolve(argv[1]) === scriptPath`, the pattern scripts/clean.ts already
 * uses) runs it. The baseline cases verify a throwaway checkout whose captured
 * baseline disagrees with its tree on `pnpm-lock.yaml`, so `verify` has
 * fingerprint drift to report under either head policy (since B-712 the check
 * before a batch does not count a different commit alone as drift).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
const baselineScript = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')

/** The throwaway checkout's files: the fingerprinted surfaces of tests/release/baseline-fingerprint.spec.ts's fixture. */
const FIXTURE_FILES: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify({ name: '@fixture/root', private: true, packageManager: 'pnpm@11.7.0' }, null, 2)}\n`,
  'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
  'packages/alpha/package.json': `${JSON.stringify({ name: '@fixture/alpha', version: '0.0.0', private: true }, null, 2)}\n`,
  'packages/beta/package.json': `${JSON.stringify({ name: '@fixture/beta', version: '0.0.0', private: true }, null, 2)}\n`,
  'packages/bundle/base/cordis.patch.yml': 'rows:\n  - id: row-alpha\n  - id: row-beta\n',
  'packages/sdk/protocol/src/types.ts': 'export interface Envelope {\n  kind: string\n}\n',
  'packages/core/session/src/known-event-types.ts': "export type KnownEventType = 'session.start'\n",
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\npackages: {}\n",
}

/** How one entry ran when it was imported with `argv[1]` pointing at it. */
interface Ran {
  readonly exitCode: number | undefined
  readonly stdout: string
  readonly stderr: string
}

const tempDirs: string[] = []

/**
 * Run one entry the way Node 24 runs a main module: `process.argv[1]` names the
 * entry, but `import.meta.main` is false because the entry is imported.
 * @param entry - the entry script's absolute path.
 * @param args - the arguments after the entry (become `process.argv[2..]`).
 * @returns how the entry exited and what it wrote.
 */
async function runImportedAsEntry(entry: string, args: readonly string[]): Promise<Ran> {
  const dir = await mkdtemp(join(tmpdir(), 'p0-01-entry-guard-'))
  tempDirs.push(dir)
  const wrapper = join(dir, 'wrapper.mjs')
  await writeFile(wrapper, [
    'import { pathToFileURL } from \'node:url\'',
    'const [entry, ...args] = process.argv.slice(2)',
    'process.argv = [process.argv[0], entry, ...args]',
    'await import(pathToFileURL(entry).href)',
    '',
  ].join('\n'))
  const result = await execa(process.execPath, [wrapper, entry, ...args], { cwd: repoRoot, reject: false })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Build a throwaway checkout, capture its baseline, then change `pnpm-lock.yaml`
 * so the tree disagrees with the captured baseline on a fingerprinted surface.
 * @returns the checkout's root.
 */
async function driftedCheckout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'p0-01-entry-guard-repo-'))
  tempDirs.push(root)
  const git = (args: readonly string[]) => execa('git', args, { cwd: root, env: { LANG: 'C', LC_ALL: 'C' } })
  await git(['init', '--initial-branch=main'])
  await git(['config', 'user.email', 'baseline-fixture@example.com'])
  await git(['config', 'user.name', 'Baseline Fixture'])
  await git(['config', 'commit.gpgsign', 'false'])
  for (const [path, content] of Object.entries(FIXTURE_FILES)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await git(['add', '-A'])
  await git(['commit', '-m', 'fixture baseline'])
  await execa(process.execPath, [baselineScript, 'capture', '--repo-root', root], { cwd: root })
  await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\npackages:\n  drifted: true\n")
  return root
}

let fixtureRoot = ''

beforeAll(async () => {
  fixtureRoot = await driftedCheckout()
}, 60_000)

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

describe('P0-01 / BLOCKED-351: a shipped entry does its work when argv[1] names it even without import.meta.main (red first for B-688)', () => {
  it('guard: the throwaway checkout drifts from its captured baseline on pnpm-lock.yaml, so verify has drift to find', async () => {
    // Started as the process entry, not imported, so every version of the
    // entry's guard runs main(): this reads the drift itself, not the guard
    // under test. If it fails, case 3 would be green for the wrong reason.
    const ran = await execa(process.execPath, [baselineScript, 'verify', '--repo-root', fixtureRoot], {
      cwd: repoRoot,
      reject: false,
    })
    expect(ran.exitCode, `stdout: ${ran.stdout.slice(-400)}; stderr: ${ran.stderr.slice(-200)}`).not.toBe(0)
    expect(`${ran.stdout}${ran.stderr}`).toContain('pnpm-lock.yaml')
  })

  it('the dsh bin prints its version when imported with argv[1] naming it', async () => {
    const ran = await runImportedAsEntry(dshBin, ['--version'])
    // The import must succeed (so a missing version means the guard was skipped,
    // not that the module threw).
    expect(ran.exitCode, `stderr tail: ${ran.stderr.slice(-400)}`).toBe(0)
    // Today `if (import.meta.main)` is false for the imported entry, so runCli
    // never runs and nothing is printed — RED. B-688's guard runs it.
    expect(ran.stdout, `stdout: ${JSON.stringify(ran.stdout)}`).toMatch(/\d+\.\d+\.\d+/u)
  })

  it('baseline-fingerprint verify detects the drift and exits non-zero when imported with argv[1] naming it', async () => {
    const ran = await runImportedAsEntry(baselineScript, ['verify', '--repo-root', fixtureRoot])
    // Today main() is guarded by import.meta.main and never runs, so verify does
    // nothing and the process exits 0 although the baseline drifts — RED. B-688's
    // guard runs main(), which detects the drift and exits 1.
    expect(ran.exitCode, `stdout: ${ran.stdout.slice(-400)}; stderr: ${ran.stderr.slice(-200)}`).not.toBe(0)
    expect(ran.stdout).toMatch(/drift detected/u)
  })
})
