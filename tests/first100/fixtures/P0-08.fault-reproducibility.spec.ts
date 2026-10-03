/**
 * P0-08 acceptance[1] (A-582a, blind review 1-5): the fault lane of the harness
 * capability benchmark reproduces, at one seed run twice, not only its drawn
 * trials and their normalized session-log projection but also WHERE each
 * injected failure landed — the failure position acceptance[1] names, which the
 * deterministic lane's R4 case does not cover for an injected fault.
 *
 * Each run is `benchmarks/harness-capability/runner.ts --lane fault --seed <n>`
 * (what `pnpm benchmark:harness` runs), keyless, launching the shipped product.
 * The lane draws the same recordings, injects a model fault (odd index) or a
 * process fault (even index) at a seed-drawn call, and reports per trial its
 * `failure` = `{ turn, step, eventIndex }` with the normalized session-log
 * digests. Two runs at one seed must report the identical trials AND the
 * identical failure positions. (A-582b covers blind 1-2/1-3/1-4/acceptance[2]
 * once B-702 adds the runner's `--patch` seam.)
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const runner = join(repoRoot, 'benchmarks/harness-capability/runner.ts')

/** The seed both fault runs use. */
const SEED = 20260924
/** Deadline for one fault-lane run: it launches real product processes and injects faults with resumes. */
const LANE_TIMEOUT_MS = 20 * 60_000

/** One failure position the report names. */
interface FailurePosition {
  readonly turn?: unknown
  readonly step?: unknown
  readonly eventIndex?: unknown
}

/** One fault trial, as far as this case reads it. */
interface Trial {
  readonly scenario?: unknown
  readonly seed?: unknown
  readonly sessionLogs?: readonly { readonly digest?: unknown }[]
  readonly failure?: FailurePosition | null
  /** The trial's human description — carried into the failure message so a mismatch is legible. */
  readonly observation?: unknown
  /** DIAGNOSTIC (never merge, B-704): the normalized projections the digests were taken from. */
  readonly normalizedLogs?: readonly unknown[]
}

/** One lane report. */
interface LaneReport {
  readonly lane?: unknown
  readonly trials?: readonly Trial[]
}

/** One run of the benchmark entry. */
interface Run {
  readonly exitCode: number | undefined
  readonly report: { readonly reports?: readonly LaneReport[] } | undefined
  readonly stderr: string
}

/** The environment with no model API configured. */
const keylessEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => name !== 'DEEPSEEK_API_KEY' && name !== 'DEEPSEEK_BASE_URL'))

const outDirs: string[] = []

/**
 * Run the fault lane once and read its report.
 * @param seed - the run seed.
 * @returns how the run exited and what it reported.
 */
async function runFaultLane(seed: number): Promise<Run> {
  const out = await mkdtemp(join(tmpdir(), 'p0-08-fault-'))
  outDirs.push(out)
  const result = await execa(process.execPath, ['--import', 'tsx/esm', runner, '--lane', 'fault', '--seed', String(seed), '--out', out], {
    cwd: repoRoot,
    env: keylessEnv,
    extendEnv: false,
    timeout: LANE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    reject: false,
  })
  let report: Run['report']
  try {
    report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8')) as Run['report']
  } catch {
    report = undefined
  }
  return { exitCode: result.exitCode, report, stderr: result.stderr }
}

/**
 * The scenario, seed, session-log digests and failure position of each trial —
 * everything acceptance[1] says one seed must reproduce for the fault lane.
 * @param run - the run.
 * @returns the comparable view.
 */
function view(run: Run | undefined): unknown[] {
  const trials = run?.report?.reports?.[0]?.trials ?? []
  return trials.map(trial => ({
    scenario: trial.scenario,
    seed: trial.seed,
    digests: (trial.sessionLogs ?? []).map(log => log.digest),
    failure: trial.failure ?? null,
  }))
}

/**
 * Both runs' trials exactly as the report wrote them, for the failure message
 * (the JSON report carries no diff, so a mismatch must be legible from here).
 * @param run - the run.
 * @returns the report's trials.
 */
function rawTrials(run: Run | undefined): readonly Trial[] {
  return run?.report?.reports?.[0]?.trials ?? []
}

/** DIAGNOSTIC (never merge, B-704): one JSON path at which two lines differ, both sides cut to 300 characters. */
interface PathDiff {
  readonly path: string
  readonly first: string
  readonly second: string
}

/**
 * DIAGNOSTIC (never merge, B-704): every JSON path at which two values differ, at most 20.
 * @param left - the first run's value.
 * @param right - the second run's value.
 * @param path - the path of these values.
 * @param out - the paths found so far.
 * @returns the differing paths.
 */
function differingPaths(left: unknown, right: unknown, path: string, out: PathDiff[]): PathDiff[] {
  if (out.length >= 20) return out
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null && Array.isArray(left) === Array.isArray(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      differingPaths((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}.${key}`, out)
    }
    return out
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    const shown = (value: unknown): string => value === undefined ? '<absent>' : JSON.stringify(value).slice(0, 300)
    out.push({ path, first: shown(left), second: shown(right) })
  }
  return out
}

/**
 * DIAGNOSTIC (never merge, B-704): parse one JSONL line, or keep it as text.
 * @param line - the line, or `undefined` past the end of a log.
 * @returns the parsed record, the raw text, or `null`.
 */
function parsedLine(line: string | undefined): unknown {
  if (line === undefined) return null
  try {
    return JSON.parse(line) as unknown
  } catch {
    // An unparsable line is compared as text; nothing else reads it.
    return line
  }
}

/**
 * DIAGNOSTIC (never merge, B-704): for each trial and log whose normalized
 * projections differ between the two runs, the line counts and the first 30
 * differing lines, each with its record type and differing JSON paths.
 * @returns one entry per differing log.
 */
function projectionDiffs(): unknown[] {
  const left = rawTrials(first)
  const right = rawTrials(second)
  const diffs: unknown[] = []
  left.forEach((trial, index) => {
    const logsA = (trial.normalizedLogs ?? []).filter((log): log is string => typeof log === 'string')
    const logsB = (right[index]?.normalizedLogs ?? []).filter((log): log is string => typeof log === 'string')
    for (let log = 0; log < Math.max(logsA.length, logsB.length); log += 1) {
      const linesA = (logsA[log] ?? '').split('\n')
      const linesB = (logsB[log] ?? '').split('\n')
      if (linesA.join('\n') === linesB.join('\n')) continue
      const lines: unknown[] = []
      for (let line = 0; line < Math.max(linesA.length, linesB.length) && lines.length < 30; line += 1) {
        if (linesA[line] === linesB[line]) continue
        const recordA = parsedLine(linesA[line])
        const recordB = parsedLine(linesB[line])
        const type = typeof recordA === 'object' && recordA !== null ? (recordA as { type?: unknown }).type : undefined
        lines.push({ line, type, paths: differingPaths(recordA, recordB, '$', []) })
      }
      diffs.push({ trial: index, scenario: trial.scenario, seed: trial.seed, log, lineCounts: [linesA.length, linesB.length], lines })
    }
  })
  return diffs
}

let first: Run | undefined
let second: Run | undefined

beforeAll(async () => {
  first = await runFaultLane(SEED)
  second = await runFaultLane(SEED)
}, 3 * LANE_TIMEOUT_MS)

afterAll(async () => {
  await Promise.all(outDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

describe('P0-08 acceptance[1] (A-582a): the fault lane reproduces each trial and the position of its injected failure at one seed', () => {
  it('both runs drew fault trials', () => {
    expect(view(first).length, `exit ${String(first?.exitCode)}; stderr tail: ${first?.stderr.slice(-400) ?? ''}`).toBeGreaterThan(0)
    expect(view(second).length, `exit ${String(second?.exitCode)}; stderr tail: ${second?.stderr.slice(-400) ?? ''}`).toBeGreaterThan(0)
  }, LANE_TIMEOUT_MS)

  it('the two runs report the identical trials, session-log projection and failure positions', () => {
    // acceptance[1]'s failure-position half: `{ turn, step, eventIndex }` per
    // trial must match across two runs at this seed, not just the drawn trials.
    // DIAGNOSTIC (never merge, B-704): the failure message carries, for every
    // log whose digest differs, the differing lines of the two normalized
    // projections and the JSON paths that differ within each line.
    expect(view(second), JSON.stringify({ diffs: projectionDiffs(), first: view(first), second: view(second) })).toEqual(view(first))
  }, LANE_TIMEOUT_MS)
})
