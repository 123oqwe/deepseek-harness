/**
 * BLOCKED-326 fix (b), red first: what the exit record beside an observation
 * report must bind and carry, how `generate-ledger.mjs` greens from it, and
 * where an override shows. The contract these cases pin is stated in
 * `artifacts/laneA/a-396-blocked-326b-expectations.md` (lane A):
 *
 * - `<report>.exit.json` is `{ exitCode, unhandledErrors, runId, reportSha256 }`;
 *   a record whose `runId` is not the `--ci-run-url` run, or whose
 *   `reportSha256` is not the report's, refuses the cell;
 * - a greened cell always carries `exitRecord: { exitCode, unhandledErrors, sha256 }`;
 * - exit 1 with no unhandled error and only registered flakes failing greens
 *   without an override; an unhandled error never does;
 * - an override shows in `--accept` (and its `acceptedEvidence`), in `--check`
 *   and in `ledger.md`;
 * - each observation step of `first100-exact-sha.yml` runs its vitest command
 *   with nothing chained or piped after it and binds the record to the run and
 *   the report.
 *
 * The CLI cases run `generate-ledger.mjs` in a scratch repository, as
 * `./generate-ledger.spec.ts` does, with a ledger row and a passing frozen case
 * so the full write path runs. The pinned override cases (they pass today)
 * take that same path, so they also show the fixture reaches the write.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { PROGRAM_CI_REPO, rowDigest } from './generate-ledger.mjs'

const fixtureRoots: string[] = []
afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Run git in a fixture repository.
 * @param cwd - the repository.
 * @param args - git's arguments.
 * @returns its trimmed stdout.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).trim()
}

/**
 * The hex sha256 of some bytes.
 * @param bytes - the bytes.
 * @returns their digest.
 */
function sha256Of(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * A scratch repository holding one commit and a copy of this directory's modules, so a run of `generate-ledger.mjs`
 * in it neither reads nor writes this repository's ledger.
 * @returns the repository's real path, its commit, and the path of its copy of `generate-ledger.mjs`.
 */
function scratchLedgerRepo(): { root: string; sha: string; script: string } {
  // The real path, because the script runs its CLI only when argv[1] equals its own module path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-exit-record-cli-')))
  fixtureRoots.push(root)
  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'fixture@example.com'])
  git(root, ['config', 'user.name', 'Fixture'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(root, 'file.txt'), 'fixture\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'fixture'])
  const sha = git(root, ['rev-parse', 'HEAD'])
  mkdirSync(join(root, 'scripts/first100'), { recursive: true })
  for (const name of readdirSync(new URL('.', import.meta.url)).filter(file => file.endsWith('.mjs'))) {
    copyFileSync(new URL(name, import.meta.url), join(root, 'scripts/first100', name))
  }
  symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'))
  mkdirSync(join(root, 'spec/first100/exec'), { recursive: true })
  return { root, sha, script: join(root, 'scripts/first100/generate-ledger.mjs') }
}

/** The frozen case the report passes. */
const TITLE = 'acp host takes over the Run'
/** A test the flake registry names. */
const FLAKE = 'suite known flake test'
/** The run every CLI case names. */
const CI_RUN_URL = `https://github.com/${PROGRAM_CI_REPO}/actions/runs/1`
/** The reason every override case gives. */
const OVERRIDE_REASON = 'fixture override reason'
/** The e2e report's file name. */
const REPORT_NAME = 'vitest-e2e-acp.json'

/** P4-05.U frozen under the e2e config, as a base entry. */
const e2eBase = {
  epic: 'P4-05',
  stage: 'U',
  argv: ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', 'apps/cli/tests/a.e2e.ts'],
  expectCases: [TITLE],
  expectExit: 0,
}

/** P4-05.U.4, a supplement frozen under the same command. */
const supplementEntry = { ...e2eBase, supplementSeq: 4, supplements: { epic: 'P4-05', stage: 'U' } }

/**
 * The P4-05 row a ledger holds before any cell is greened.
 * @param extra - fields to set on it.
 * @returns the row.
 */
function ledgerRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'P4-05',
    title: 'fixture',
    layer: 'orchestration-runtime',
    canonicalOwner: 'fixture',
    predecessors: [],
    wave: 4,
    cells: {},
    supplements: {},
    candidateSha: null,
    independentVerdict: 'PENDING',
    openFindings: [],
    status: 'BLOCKED_ON_ACCEPTANCE',
    ...extra,
  }
}

/** A cell or supplement as the ledger records it, in the fields these cases read. */
type Cell = Readonly<Record<string, unknown>> & {
  readonly exitRecord?: Readonly<Record<string, unknown>>
  readonly exitOverride?: Readonly<Record<string, unknown>>
}

/** The ledger after a run, in the fields these cases read. */
interface Ledger {
  readonly rows: Readonly<Record<string, {
    readonly cells: Readonly<Record<string, Cell | undefined>>
    readonly supplements: Readonly<Record<string, Cell | undefined>>
    readonly acceptedEvidence?: { readonly cells?: Readonly<Record<string, Cell | undefined>> } | null
  } | undefined>>
}

/** What one greening run left. */
interface Greening {
  readonly status: number | null
  readonly output: string
  readonly ledger: Ledger
  readonly ledgerMd: string
  readonly recordBytes: string | undefined
}

/**
 * The exit record a bound, clean step writes, with fields replaced.
 * @param overrides - the fields to replace.
 * @returns a builder from the report's sha256 to the record.
 */
function boundRecord(overrides: Record<string, unknown> = {}): (reportSha: string) => Record<string, unknown> {
  return reportSha => ({ exitCode: 0, unhandledErrors: 0, runId: '1', reportSha256: reportSha, ...overrides })
}

/**
 * Green P4-05.U, or its supplement U.4, in a scratch repository through the full write path.
 * @param options - the failing cases the report holds, the flakes the registry names, the exit record (built from the
 *   report's sha256; `undefined` for none), extra arguments, and whether to green the supplement.
 * @returns the exit status, the output, and the ledger and `ledger.md` the run left.
 */
function green(options: {
  readonly failed?: readonly string[]
  readonly flakes?: readonly string[]
  readonly record?: (reportSha: string) => Record<string, unknown> | undefined
  readonly args?: readonly string[]
  readonly supplement?: boolean
}): Greening {
  const { root, sha, script } = scratchLedgerRepo()
  writeFileSync(join(root, 'spec/first100/exec/command-freeze.json'), JSON.stringify({ entries: [e2eBase, supplementEntry] }))
  writeFileSync(join(root, 'spec/first100/exec/ledger.json'), JSON.stringify({
    generatedBy: 'scripts/first100/generate-ledger.mjs',
    rows: { 'P4-05': ledgerRow() },
  }))
  if (options.flakes !== undefined) {
    writeFileSync(join(root, 'spec/first100/exec/flake-registry.json'), JSON.stringify({
      entries: options.flakes.map(testFullName => ({ testFullName })),
    }))
  }
  mkdirSync(join(root, sha))
  const reportPath = `${sha}/${REPORT_NAME}`
  const failed = options.failed ?? []
  const assertionResults = [
    { status: 'passed', title: TITLE, fullName: TITLE },
    ...failed.map(name => ({ status: 'failed', title: name, fullName: name })),
  ]
  const reportText = JSON.stringify({ success: failed.length === 0, testResults: [{ name: '/ci/apps/cli/tests/a.e2e.ts', assertionResults }] })
  writeFileSync(join(root, reportPath), reportText)
  const record = options.record?.(sha256Of(reportText))
  const recordBytes = record === undefined ? undefined : JSON.stringify(record)
  if (recordBytes !== undefined) writeFileSync(join(root, reportPath.replace(/\.json$/u, '.exit.json')), recordBytes)
  const cellArgs = options.supplement === true
    ? ['--supplement', '--epic', 'P4-05', '--stage', 'U', '--supplement-seq', '4']
    : ['--epic', 'P4-05', '--stage', 'U']
  const args = [...cellArgs, '--report', reportPath, '--ci-run-url', CI_RUN_URL, '--candidate-sha', sha, ...options.args ?? []]
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' })
  const mdPath = join(root, 'spec/first100/exec/ledger.md')
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    ledger: JSON.parse(readFileSync(join(root, 'spec/first100/exec/ledger.json'), 'utf8')) as Ledger,
    ledgerMd: existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : '',
    recordBytes,
  }
}

describe('BLOCKED-326 (b): a registered-flake run with no unhandled error greens without an override, and an unhandled error never does', () => {
  it('A1: exit 1, no unhandled error and only registered flakes failing: greened without an override, the cell records both numbers', () => {
    const run = green({ failed: [FLAKE], flakes: [FLAKE], record: boundRecord({ exitCode: 1, unhandledErrors: 0 }) })
    expect(run.status, run.output).toBe(0)
    const cell = run.ledger.rows['P4-05']?.cells.U
    expect(cell?.status).toBe('GREEN')
    expect(cell?.exitRecord, JSON.stringify(cell)).toMatchObject({ exitCode: 1, unhandledErrors: 0 })
    expect(cell?.exitOverride).toBeUndefined()
  })

  it('A2 guard: a registered flake beside one unhandled error is refused without an override, and no cell is written', () => {
    const run = green({ failed: [FLAKE], flakes: [FLAKE], record: boundRecord({ exitCode: 1, unhandledErrors: 1 }) })
    expect(run.output).toContain('BLOCKED')
    expect(run.status).toBe(1)
    expect(run.ledger.rows['P4-05']?.cells.U).toBeUndefined()
  })
})

describe('BLOCKED-326 (b): the exit record is bound to its run and its report, and the cell keeps it', () => {
  it('B1: a record naming another run is refused, and no cell is written', () => {
    const run = green({ record: boundRecord({ runId: '2' }) })
    expect(run.output).toContain('BLOCKED')
    expect(run.status).toBe(1)
    expect(run.ledger.rows['P4-05']?.cells.U).toBeUndefined()
  })

  it('B2: a record naming another report is refused, and no cell is written', () => {
    const run = green({ record: boundRecord({ reportSha256: '0'.repeat(64) }) })
    expect(run.output).toContain('BLOCKED')
    expect(run.status).toBe(1)
    expect(run.ledger.rows['P4-05']?.cells.U).toBeUndefined()
  })

  it('B3: a greened cell carries the exit record it was greened on, by exit code, unhandled errors and digest', () => {
    const run = green({ record: boundRecord() })
    expect(run.status, run.output).toBe(0)
    const cell = run.ledger.rows['P4-05']?.cells.U
    expect(cell?.exitRecord, JSON.stringify(cell)).toMatchObject({ exitCode: 0, unhandledErrors: 0, sha256: sha256Of(run.recordBytes ?? '') })
  })
})

describe('BLOCKED-326: a cell greened under an override records it (pinned)', () => {
  it('D1: the base cell records the recorded exit code and the reason', () => {
    const run = green({ record: () => ({ exitCode: 1 }), args: ['--exit-override', 'r'] })
    expect(run.status, run.output).toBe(0)
    expect(run.ledger.rows['P4-05']?.cells.U?.exitOverride).toMatchObject({ exitCode: 1, reason: 'r' })
  })

  it('D2: a supplement records the recorded exit code and the reason', () => {
    const run = green({ record: () => ({ exitCode: 1 }), args: ['--exit-override', 'r'], supplement: true })
    expect(run.status, run.output).toBe(0)
    expect(run.ledger.rows['P4-05']?.supplements['U.4']?.exitOverride).toMatchObject({ exitCode: 1, reason: 'r' })
  })

  it('D3: with no exit record the cell records a null exit code and the reason', () => {
    const run = green({ record: () => undefined, args: ['--exit-override', 'r'] })
    expect(run.status, run.output).toBe(0)
    expect(run.ledger.rows['P4-05']?.cells.U?.exitOverride).toMatchObject({ exitCode: null, reason: 'r' })
  })
})

describe('BLOCKED-326 (b): an override shows wherever a reader of the ledger looks', () => {
  it('C3: ledger.md marks a cell greened under an override', () => {
    const run = green({ record: () => ({ exitCode: 1 }), args: ['--exit-override', OVERRIDE_REASON] })
    expect(run.status, run.output).toBe(0)
    const line = run.ledgerMd.split('\n').find(text => text.includes('| P4-05 |')) ?? ''
    expect(line, run.ledgerMd).toMatch(/override/iu)
  })

  it('C2: --check names a cell greened under an override and its reason', () => {
    const { root, script } = scratchLedgerRepo()
    const observationReportPath = 'ci-run-1/vitest-report.json'
    mkdirSync(join(root, 'ci-run-1'))
    writeFileSync(join(root, observationReportPath), JSON.stringify({ success: true, testResults: [] }))
    const cell = { status: 'GREEN', observationReportPath, exitOverride: { exitCode: 1, reason: OVERRIDE_REASON } }
    writeFileSync(join(root, 'spec/first100/exec/ledger.json'), JSON.stringify({
      generatedBy: 'scripts/first100/generate-ledger.mjs',
      rows: { 'P4-05': { status: 'BLOCKED_ON_ACCEPTANCE', cells: { U: cell }, supplements: {} } },
    }))
    const result = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' })
    const output = `${result.stdout}${result.stderr}`
    expect(output).toContain('verify: ')
    expect(result.status).toBe(0)
    expect(output).toContain(OVERRIDE_REASON)
  })

  it('C1: --accept prints a cell greened under an override with its exit code and reason, and copies the override into acceptedEvidence', () => {
    const { root, script } = scratchLedgerRepo()
    const notApplicable = { nOf: 'N/A' }
    const stages = { C: notApplicable, P: notApplicable, U: { nOf: 1 }, F: notApplicable }
    const documents: Record<string, unknown> = {
      'tests/first100/registry.json': { epics: [{ id: 'P4-05', acceptance: [TITLE], stages }] },
      'tests/first100/adjudication.json': {},
      'spec/first100/exec/command-freeze.json': { entries: [e2eBase] },
      'spec/first100/exec/acceptance-coverage.json': { entries: [{ epic: 'P4-05', acceptanceIndex: 0, coveredBy: [{ stage: 'U', title: TITLE }] }] },
      'spec/first100/exec/make-vs-use-ledger.json': { rows: [] },
      'spec/first100/exec/clause-subject-audit.json': {},
      'spec/first100/exec/standards-ownership.json': {},
    }
    mkdirSync(join(root, 'tests/first100'), { recursive: true })
    for (const [path, document] of Object.entries(documents)) writeFileSync(join(root, path), JSON.stringify(document))
    // The make-vs-use import scan's positive control: --accept refuses every row when the scan finds nothing.
    mkdirSync(join(root, 'packages/action/action-manifest/tests'), { recursive: true })
    writeFileSync(join(root, 'packages/action/action-manifest/tests/manifest.spec.ts'), "import canonicalize from 'canonicalize'\n")
    // The candidate commit holds the freeze, which verify-freeze-in-candidate-tree reads at the cell's candidate.
    writeFileSync(join(root, 'file.txt'), 'candidate\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'candidate'])
    const candidateSha = git(root, ['rev-parse', 'HEAD'])
    const observationReportPath = `ci-run-1/${REPORT_NAME}`
    mkdirSync(join(root, 'ci-run-1'))
    writeFileSync(join(root, observationReportPath), JSON.stringify({ success: true, testResults: [] }))
    const cell = {
      status: 'GREEN',
      candidateSha,
      ciRunUrl: CI_RUN_URL,
      observationReportPath,
      observationSha256: 'fixture',
      expectCasesMatched: [TITLE],
      exitOverride: { exitCode: 1, reason: OVERRIDE_REASON },
    }
    const row = ledgerRow({ cells: { U: cell }, candidateSha })
    writeFileSync(join(root, 'spec/first100/exec/ledger.json'), JSON.stringify({ generatedBy: 'scripts/first100/generate-ledger.mjs', rows: { 'P4-05': row } }))
    const signoff = { epic: 'P4-05', conclusion: 'PASS', rowDigestSha256: rowDigest(row), delegateSession: 'fixture', signedAtUtc: '2026-09-24T00:00:00Z' }
    writeFileSync(join(root, 'spec/first100/exec/delegate-signoff.json'), JSON.stringify({ entries: [signoff] }))
    const result = spawnSync(process.execPath, [script, '--accept', '--epic', 'P4-05'], { cwd: root, encoding: 'utf8' })
    const output = `${result.stdout}${result.stderr}`
    expect(output).toContain('ACCEPTED P4-05: independentVerdict=APPROVED, status=ACCEPTED')
    expect(result.status).toBe(0)
    expect(output).toContain(OVERRIDE_REASON)
    const ledger = JSON.parse(readFileSync(join(root, 'spec/first100/exec/ledger.json'), 'utf8')) as Ledger
    expect(ledger.rows['P4-05']?.acceptedEvidence?.cells?.U?.exitOverride).toMatchObject({ exitCode: 1, reason: OVERRIDE_REASON })
  })
})

/** One step of `first100-exact-sha.yml`'s gate job, in the fields the cases below read. */
interface GateStep {
  readonly name?: string
  readonly run?: string
  readonly shell?: string
}

/**
 * The lines of one step's vitest command, from `pnpm exec vitest` through the line naming the report.
 * @param run - the step's run text.
 * @returns those lines, or none when the step has no such command.
 */
function commandLines(run: string): string[] {
  const lines = run.split('\n')
  const start = lines.findIndex(line => line.trimStart().startsWith('pnpm exec vitest'))
  const end = lines.findIndex(line => line.includes('--outputFile='))
  return start < 0 || end < start ? [] : lines.slice(start, end + 1)
}

describe('BLOCKED-326: each observation step of first100-exact-sha.yml records the exit of its vitest command alone', () => {
  const workflow = load(readFileSync(new URL('../../.github/workflows/first100-exact-sha.yml', import.meta.url), 'utf8')) as {
    jobs: Record<string, { steps: GateStep[] }>
  }
  const writers = (workflow.jobs['exact-sha-gate']?.steps ?? [])
    .filter(step => /--outputFile=\.artifacts\/first100\/observations\/\S+\.json/u.test(step.run ?? ''))

  it('E1 guard: nothing is chained or piped after the command, set +e comes right before it, one line writes the record, and no shell is set', () => {
    expect(writers.length).toBeGreaterThan(0)
    for (const step of writers) {
      const run = step.run ?? ''
      const lines = run.split('\n')
      const command = commandLines(run)
      expect(command.length, step.name).toBeGreaterThan(0)
      for (const line of command) expect(line, step.name).not.toMatch(/\||&&|;/u)
      expect(lines[lines.indexOf(command[0] ?? '') - 1]?.trim(), step.name).toBe('set +e')
      const record = `${/--outputFile=(\S+)\.json/u.exec(run)?.[1] ?? ''}.exit.json`
      expect(lines.filter(line => line.includes(`> ${record}`)), step.name).toHaveLength(1)
      expect(step.shell, step.name).toBeUndefined()
    }
  })

  it('E2: each step binds its exit record to the run and to the report', () => {
    expect(writers.length).toBeGreaterThan(0)
    for (const step of writers) {
      const run = step.run ?? ''
      expect(/GITHUB_RUN_ID|github\.run_id/u.test(run), step.name).toBe(true)
      expect(run, step.name).toMatch(/sha256/u)
    }
  })
})
