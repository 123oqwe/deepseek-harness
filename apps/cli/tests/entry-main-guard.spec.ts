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
 * uses) runs it. The baseline guard: the committed `.dsh/baseline.json` records
 * a different commit than this checkout, so `verify` has real drift to report.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
const baselineScript = join(repoRoot, 'scripts/release/baseline-fingerprint.mjs')
const baselinePath = join(repoRoot, '.dsh/baseline.json')

/** How one entry ran when it was imported with `argv[1]` pointing at it. */
interface Ran {
  readonly exitCode: number | undefined
  readonly stdout: string
  readonly stderr: string
}

const wrapperDirs: string[] = []

/**
 * Run one entry the way Node 24 runs a main module: `process.argv[1]` names the
 * entry, but `import.meta.main` is false because the entry is imported.
 * @param entry - the entry script's absolute path.
 * @param args - the arguments after the entry (become `process.argv[2..]`).
 * @returns how the entry exited and what it wrote.
 */
async function runImportedAsEntry(entry: string, args: readonly string[]): Promise<Ran> {
  const dir = await mkdtemp(join(tmpdir(), 'p0-01-entry-guard-'))
  wrapperDirs.push(dir)
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

let headSha = ''
let baselineText = ''

beforeAll(async () => {
  headSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim()
  baselineText = await readFile(baselinePath, 'utf8')
})

afterAll(async () => {
  await Promise.all(wrapperDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

describe('P0-01 / BLOCKED-351: a shipped entry does its work when argv[1] names it even without import.meta.main (red first for B-688)', () => {
  it('guard: the committed baseline records a different commit than this checkout, so verify has drift to find', () => {
    // If this fails, the baseline does not drift here and case 2 would be green
    // for the wrong reason; it is the harness guard, not the subject.
    expect(baselineText, 'baseline.json').not.toContain(headSha)
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
    const ran = await runImportedAsEntry(baselineScript, ['verify', '--repo-root', repoRoot])
    // Today main() is guarded by import.meta.main and never runs, so verify does
    // nothing and the process exits 0 although the baseline drifts — RED. B-688's
    // guard runs main(), which detects the drift and exits 1.
    expect(ran.exitCode, `stdout: ${ran.stdout.slice(-400)}; stderr: ${ran.stderr.slice(-200)}`).not.toBe(0)
    expect(ran.stdout).toMatch(/drift detected/u)
  })
})
