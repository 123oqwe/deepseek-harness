/**
 * P0-08 composition: the command the registry names, `pnpm benchmark:harness`,
 * run as a child process at the repository root with every `*_API_KEY`
 * variable removed from its environment.
 *
 * BLOCKED-270 measured that the command did not exist, and its lock states
 * that a passing unit case over `runLanes` is not the signal. So every case
 * spawns the command and reads the files it wrote to a fresh `--out`
 * directory. The one in-process `runLanes` call, in the seed case, is the
 * reference the child's report is compared with, never the observation.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { runLanes } from '../../../benchmarks/harness-capability/runner.ts'
import { SCENARIOS } from '../../../benchmarks/harness-capability/scenarios/index.ts'

const repoRoot = resolve(import.meta.dirname, '../../..')

/** Every case starts pnpm, tsx and the runner at least once; the seed case does it three times. */
const CASE_OPTIONS = { timeout: 120_000 }

interface LaneReportJson {
  readonly lane: string
  readonly model: { readonly trials: number }
  readonly invariants: { readonly held: boolean }
  readonly replaySeeds: readonly unknown[]
}

interface ReportJson {
  readonly reports: readonly LaneReportJson[]
  readonly skipped: readonly unknown[]
}

const outDirs: string[] = []

afterEach(() => {
  for (const dir of outDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * The test process's environment without any `*_API_KEY` variable, so the
 * child runs with no external API configured.
 * @returns the environment for the child.
 */
function keylessEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.endsWith('_API_KEY')))
}

/**
 * Run `pnpm benchmark:harness <args> --out <fresh directory>` at the repository root.
 * @param args - the arguments before `--out`.
 * @returns the child's result and the directory its reports are written to.
 */
function benchmarkHarness(args: readonly string[]): { readonly result: SpawnSyncReturns<string>, readonly out: string } {
  const out = mkdtempSync(join(tmpdir(), 'dsh-p0-08-'))
  outDirs.push(out)
  const result = spawnSync('pnpm', ['benchmark:harness', ...args, '--out', out], { cwd: repoRoot, env: keylessEnv(), encoding: 'utf8' })
  return { result, out }
}

/**
 * Parse the JSON report a run wrote.
 * @param out - the run's `--out` directory.
 * @returns the parsed report.
 */
function readReport(out: string): ReportJson {
  return JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as ReportJson
}

/**
 * Both output streams of a run, for assertion messages.
 * @param result - the run.
 * @returns stdout and stderr, labelled.
 */
function output(result: SpawnSyncReturns<string>): string {
  return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
}

it('P0-08 composition: pnpm benchmark:harness --lane deterministic runs with no external API key and writes both the JSON and the Markdown report', CASE_OPTIONS, () => {
  const { result, out } = benchmarkHarness(['--lane', 'deterministic'])
  expect(result.status, output(result)).toBe(0)

  // Content, not the exit status alone: a module with no entry point also
  // exits 0 (BLOCKED-270). 16 trials is two deterministic scenarios at the
  // runner's default of 8, and one report proves `--lane` was applied.
  const report = readReport(out)
  expect(report.reports.map(lane => lane.lane)).toEqual(['deterministic'])
  expect(report.reports[0]?.model.trials).toBe(16)
  expect(report.skipped).toEqual([])
  for (const lane of report.reports) {
    expect(lane).toHaveProperty('model')
    expect(lane).toHaveProperty('invariants')
  }
  const markdown = readFileSync(join(out, 'report.md'), 'utf8')
  expect(markdown.split('\n').some(line => line.startsWith('- deterministic: task success') && line.includes('invariants')), markdown).toBe(true)
})

it('P0-08 composition: with no --lane the same command runs every keyless lane, and each lane gets its own report', CASE_OPTIONS, () => {
  const { result, out } = benchmarkHarness([])
  expect(result.status, output(result)).toBe(0)

  const report = readReport(out)
  expect(report.reports).toHaveLength(3)
  expect(Object.fromEntries(report.reports.map(lane => [lane.lane, lane.model.trials] as const))).toEqual({ deterministic: 16, fault: 8, security: 8 })
  expect(report.skipped).toEqual([])
})

it('P0-08 composition: two runs at one --seed write byte-identical JSON reports equal to runLanes at that seed, and a different --seed changes the lane results', CASE_OPTIONS, () => {
  const first = benchmarkHarness(['--lane', 'deterministic', '--seed', '20260904'])
  const second = benchmarkHarness(['--lane', 'deterministic', '--seed', '20260904'])
  const other = benchmarkHarness(['--lane', 'deterministic', '--seed', '20260905'])
  for (const run of [first, second, other]) expect(run.result.status, output(run.result)).toBe(0)

  expect(readFileSync(join(second.out, 'report.json'), 'utf8')).toBe(readFileSync(join(first.out, 'report.json'), 'utf8'))
  const report = readReport(first.out)
  // A failure position must exist for "the same failure position" to be compared.
  expect(report.reports[0]?.replaySeeds.length).toBeGreaterThan(0)
  // The written lanes are the library's result at that seed, so the file
  // cannot be a constant that merely repeats itself.
  const reference = JSON.parse(JSON.stringify(runLanes(SCENARIOS.filter(scenario => scenario.lane === 'deterministic'), { seed: 20260904 }).reports)) as unknown
  expect(report.reports).toEqual(reference)
  // `reports` only: the top-level `seed` field differs by construction.
  expect(JSON.stringify(readReport(other.out).reports)).not.toBe(JSON.stringify(report.reports))
})

it('P0-08 composition: a lane with no scenario is refused by the runner itself and writes no report, so an empty run never reads as completed', CASE_OPTIONS, () => {
  const { result, out } = benchmarkHarness(['--lane', 'scale'])
  expect(result.status, output(result)).not.toBe(0)
  // The runner's own refusal: a missing script also exits non-zero and writes nothing.
  expect(result.stderr).toContain('no scenario in lane scale')
  expect(existsSync(join(out, 'report.json'))).toBe(false)
})
