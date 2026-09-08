/**
 * The frozen-title resolvability gate reads its reports from a FILE (§12.56).
 *
 * **The check is unchanged; only how it obtains the output changed.** The gate
 * used to collect each run's `--reporter=json` document from stdout, which
 * buffered the whole thing in the gate's own process. Measured: it completed
 * at 209 freeze entries and stopped completing at 216, dying mid-gate — a cost
 * that grows with a file the program appends to every working day, for a
 * reason unrelated to what the gate verifies.
 *
 * These cases pin the property that the change was supposed to preserve: for
 * one fixture containing a deliberately broken title, the UNRESOLVED set is
 * exactly the broken one. A refactor that quietly stopped resolving titles
 * would report everything as unresolved and pass a weaker assertion; a
 * refactor that stopped reading reports at all would report nothing.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = 'scripts/first100/verify-frozen-titles-resolvable.mjs'
const FREEZE = 'spec/first100/exec/command-freeze.json'
const RENAMES = 'spec/first100/exec/frozen-title-renames.json'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/**
 * A stand-in for the frozen command: a node script that honours `--outputFile`
 * exactly as vitest's json reporter does, and writes the cases it was told to.
 *
 * Using a real subprocess rather than stubbing the spawn is deliberate — the
 * behaviour under test IS the file handoff, so a fixture that skipped the
 * process boundary would verify the half that did not change.
 */
const FAKE_RUNNER = `
const args = process.argv.slice(2)
const at = args.indexOf('--outputFile')
const cases = JSON.parse(args[args.indexOf('--cases') + 1])
require('node:fs').writeFileSync(args[at + 1], JSON.stringify({
  testResults: [{ assertionResults: cases.map((c) => ({ title: c, fullName: c, status: 'passed' })) }],
}))
`

function prepare(entries: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-frozen-titles-spec-'))
  roots.push(root)
  mkdirSync(join(root, 'spec/first100/exec'), { recursive: true })
  mkdirSync(join(root, 'scripts/first100'), { recursive: true })
  writeFileSync(join(root, FREEZE), JSON.stringify({ entries }))
  writeFileSync(join(root, RENAMES), JSON.stringify({ entries: [] }))
  writeFileSync(join(root, 'runner.cjs'), FAKE_RUNNER)
  cpSync(join(REPO, SCRIPT), join(root, SCRIPT))
  return root
}

function run(root: string): { code: number; output: string } {
  try {
    return { code: 0, output: execFileSync(process.execPath, [join(root, SCRIPT)], { cwd: root, encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string }
    return { code: failure.status, output: `${failure.stdout}${failure.stderr}` }
  }
}

/** A freeze entry whose command emits `emits` and whose commitment is `expectCases`. */
function entry(epic: string, emits: readonly string[], expectCases: readonly string[]): unknown {
  return {
    epic,
    stage: 'C',
    argv: [process.execPath, 'runner.cjs', '--cases', JSON.stringify(emits)],
    expectExit: 0,
    expectCases,
  }
}

describe('§12.56: the gate reads its report from a file, and resolves the same titles', () => {
  it('resolves every title a run emits, and reports NOTHING unresolved when they all match', () => {
    const root = prepare([entry('P0-01', ['case one', 'case two'], ['case one', 'case two'])])

    const { code, output } = run(root)

    expect(output).toContain('0 UNRESOLVED')
    expect(code).toBe(0)
  })

  it('reports exactly the ONE deliberately broken title as UNRESOLVED, not all of them', () => {
    // The load-bearing assertion. A refactor that stopped resolving titles
    // would mark every commitment unresolved and still "fail on a broken
    // title"; only checking that the OTHER titles resolved catches that.
    const root = prepare([
      entry('P0-01', ['case one', 'case two'], ['case one', 'case two', 'a title no case emits']),
    ])

    const { code, output } = run(root)

    expect(code).not.toBe(0)
    expect(output).toContain('1 UNRESOLVED')
    // Scoped to the UNRESOLVED block: the command's own argv is echoed in the
    // "running ..." line and contains every case name, so asserting over the
    // whole output would pass on text that says nothing about resolution.
    const unresolved = output.slice(output.indexOf('UNRESOLVED (fail-closed):'))
    expect(unresolved).toContain('a title no case emits')
    expect(unresolved).not.toContain('case one')
    expect(unresolved).not.toContain('case two')
  })

  it('runs each unique command ONCE across the entries that share it', () => {
    // The cache is what keeps 216 entries from becoming 216 subprocesses; the
    // file handoff removed the memory ceiling and this keeps the run count
    // down, and the two together are why the gate completes.
    const shared = ['shared case']
    const root = prepare([
      entry('P0-01', shared, ['shared case']),
      entry('P0-02', shared, ['shared case']),
    ])

    const { output } = run(root)

    expect(output.match(/^running /gmu)).toHaveLength(1)
    expect(output).toContain('0 UNRESOLVED')
  })

  it('reports a command that wrote NO report as unreadable rather than as zero titles', () => {
    // An empty result must never read as "this command resolves nothing";
    // that would turn a broken command into a silent pass for any entry whose
    // commitments were already satisfied elsewhere.
    const root = prepare([{
      epic: 'P0-01',
      stage: 'C',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      expectExit: 0,
      expectCases: ['case one'],
    }])

    const { code, output } = run(root)

    expect(code).not.toBe(0)
    expect(output).toMatch(/did not write a parseable|UNREADABLE|unresolved/iu)
  })
})
