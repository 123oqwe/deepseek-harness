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
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { ReportContext } from './verify-frozen-titles-resolvable.mjs'
import { commandFilters, planCommand, repositoryPath, unitOf } from './verify-frozen-titles-resolvable.mjs'

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

describe('report mode: planning one command against a full-suite report', () => {
  const file = (path: string, ...titles: string[]) => ({ path, assertionResults: titles.map(title => ({ title, fullName: title, status: 'passed' })) })
  const context = (over: Partial<ReportContext> = {}): ReportContext => ({
    reportFiles: [file('packages/g/p/tests/a.spec.ts', 'case a'), file('packages/g/q/tests/b.spec.ts', 'case b')],
    testFiles: ['packages/g/p/tests/a.spec.ts', 'packages/g/q/tests/b.spec.ts'],
    changedUnits: new Set(['spec/first100/exec']),
    sharedInputsChanged: [],
    ...over,
  })
  const vitest = (...rest: string[]): string[] => ['pnpm', 'exec', 'vitest', 'run', ...rest, '--reporter=json']

  it('resolves from the report files the filter selects, and only those', () => {
    const plan = planCommand(vitest('packages/g/p'), context())
    expect(plan.reasons).toBeUndefined()
    expect(plan.testResults?.flatMap(result => result.assertionResults.map(assertion => assertion.title))).toStrictEqual(['case a'])
  })

  it('runs the command when a unit of a selected file changed since the report', () => {
    expect(planCommand(vitest('packages/g/p'), context({ changedUnits: new Set(['packages/g/p']) })).reasons)
      .toStrictEqual(['changed since the report: packages/g/p'])
  })

  it('runs the command when a test file this tree selects is missing from the report', () => {
    const testFiles = ['packages/g/p/tests/a.spec.ts', 'packages/g/q/tests/b.spec.ts', 'packages/g/q/tests/new.spec.ts']
    expect(planCommand(vitest('packages/g'), context({ testFiles })).reasons).toStrictEqual(['not in the report: packages/g/q/tests/new.spec.ts'])
  })

  it('runs every command when a shared test input changed', () => {
    expect(planCommand(vitest('packages/g/p'), context({ sharedInputsChanged: ['vitest.config.ts'] })).reasons)
      .toStrictEqual(['shared test input changed: vitest.config.ts'])
  })

  it('runs a command it cannot read: another runner, an unknown flag, or no path filter; -t keeps its filters', () => {
    expect(commandFilters(['node', 'runner.cjs'])).toStrictEqual({ reason: 'not a `pnpm exec vitest run` command' })
    expect(commandFilters(vitest('packages/g/p', '--bail'))).toStrictEqual({ reason: 'flag --bail is not one report mode reads' })
    expect(commandFilters(['pnpm', 'exec', 'vitest', 'run', '--reporter=json'])).toStrictEqual({ reason: 'no path filter, so the command runs every test file' })
    expect(commandFilters(vitest('packages/g/p', '-t', 'case a'))).toStrictEqual({ filters: ['packages/g/p'] })
  })

  it('maps a CI path onto the tree, a deleted file from its first top-level segment, and paths onto units', () => {
    const tree = new Set(['packages/g/p/tests/a.spec.ts'])
    expect(repositoryPath('/home/runner/work/x/x/packages/g/p/tests/a.spec.ts', tree)).toBe('packages/g/p/tests/a.spec.ts')
    expect(repositoryPath('/home/runner/work/x/x/packages/g/p/tests/gone.spec.ts', tree)).toBe('packages/g/p/tests/gone.spec.ts')
    expect(unitOf('scripts/verify-import-integrity.spec.ts')).toBe('scripts')
    expect(unitOf('tests/first100/fixtures/P4-02.composition.spec.ts')).toBe('tests/first100')
  })
})

/**
 * A stand-in `pnpm`: writes the report vitest would, with the titles `cases.json` lists for each path filter it was
 * given, and logs every call so a case can tell a resolved command from a run one.
 */
const FAKE_PNPM = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const root = path.dirname(__dirname)
const args = process.argv.slice(2)
fs.appendFileSync(path.join(root, 'pnpm-calls.log'), JSON.stringify(args) + '\\n')
const cases = JSON.parse(fs.readFileSync(path.join(root, 'cases.json'), 'utf8'))
const titles = Object.entries(cases).filter(([filter]) => args.includes(filter)).flatMap(([, list]) => list)
fs.writeFileSync(args[args.indexOf('--outputFile') + 1], JSON.stringify({
  testResults: [{ assertionResults: titles.map((title) => ({ title, fullName: title, status: 'passed' })) }],
}))
`

/**
 * A git repository with one committed test file, a freeze entry whose command selects it, the fake `pnpm`, and a
 * report directory named after the commit holding `reportTitles`.
 * @param reportTitles - the titles the full-suite report records for the test file.
 * @returns the root and the report path.
 */
function reportRepo(reportTitles: readonly string[]): { root: string; report: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-frozen-titles-report-'))
  roots.push(root)
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  mkdirSync(join(root, 'packages/g/p/tests'), { recursive: true })
  writeFileSync(join(root, 'packages/g/p/tests/a.spec.ts'), '// fixture\n')
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  git('add', '.')
  git('commit', '-q', '-m', 'reported tree')
  const sha = git('rev-parse', 'HEAD')
  for (const directory of ['spec/first100/exec', 'scripts/first100', 'bin']) mkdirSync(join(root, directory), { recursive: true })
  writeFileSync(join(root, FREEZE), JSON.stringify({ entries: [{
    epic: 'P0-01',
    stage: 'C',
    argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/g/p', '--reporter=json'],
    expectExit: 0,
    expectCases: ['case a'],
  }] }))
  writeFileSync(join(root, RENAMES), JSON.stringify({ entries: [] }))
  cpSync(join(REPO, SCRIPT), join(root, SCRIPT))
  writeFileSync(join(root, 'bin/pnpm'), FAKE_PNPM)
  chmodSync(join(root, 'bin/pnpm'), 0o755)
  writeFileSync(join(root, 'cases.json'), JSON.stringify({ 'packages/g/p': ['case a'] }))
  const reportDirectory = join(root, 'reports', `first100-vitest-report-${sha}`)
  mkdirSync(reportDirectory, { recursive: true })
  const report = join(reportDirectory, 'vitest-report.json')
  writeFileSync(report, JSON.stringify({
    numFailedTestSuites: 0,
    testResults: [{
      name: '/ci/checkout/packages/g/p/tests/a.spec.ts',
      assertionResults: reportTitles.map(title => ({ title, fullName: title, status: 'passed' })),
    }],
  }))
  return { root, report }
}

function runWithReport(root: string, report: string): { code: number; output: string; pnpmCalls: number } {
  const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}` }
  let code = 0
  let output: string
  try {
    output = execFileSync(process.execPath, [join(root, SCRIPT), '--from-report', report], { cwd: root, encoding: 'utf8', stdio: 'pipe', env })
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string }
    code = failure.status
    output = `${failure.stdout}${failure.stderr}`
  }
  const log = join(root, 'pnpm-calls.log')
  return { code, output, pnpmCalls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0 }
}

describe('report mode end to end: a bound report stands in for the run, and anything unbound runs', () => {
  it('resolves a command from a report at HEAD without running it', () => {
    const { root, report } = reportRepo(['case a'])
    const result = runWithReport(root, report)
    expect(result.pnpmCalls).toBe(0)
    expect(result.output).toContain('report mode: 1 command(s) resolved from the report')
    expect(result.output).toContain('0 UNRESOLVED')
    expect(result.code).toBe(0)
  })

  it('reports a frozen title the report lacks as UNRESOLVED, so the names really come from the report', () => {
    const { root, report } = reportRepo(['another case'])
    const result = runWithReport(root, report)
    expect(result.pnpmCalls).toBe(0)
    expect(result.output).toContain('1 UNRESOLVED')
    expect(result.code).not.toBe(0)
  })

  it('runs the command when its selected file changed after the report, and resolves from that run', () => {
    const { root, report } = reportRepo(['another case'])
    writeFileSync(join(root, 'packages/g/p/tests/a.spec.ts'), '// edited after the report\n')
    const result = runWithReport(root, report)
    expect(result.pnpmCalls).toBe(1)
    expect(result.output).toContain('changed since the report: packages/g/p')
    expect(result.output).toContain('0 UNRESOLVED')
  })

  it('refuses a report whose directory names no ancestor of HEAD, and then runs every command', () => {
    const { root, report } = reportRepo(['case a'])
    const moved = join(root, 'reports', 'first100-vitest-report-0123456789abcdef0123456789abcdef01234567')
    renameSync(dirname(report), moved)
    const result = runWithReport(root, join(moved, 'vitest-report.json'))
    expect(result.output).toContain('report mode refused')
    expect(result.pnpmCalls).toBe(1)
    expect(result.output).toContain('0 UNRESOLVED')
  })
})
