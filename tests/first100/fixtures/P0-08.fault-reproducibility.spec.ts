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
    // The failure message carries both runs' full trials verbatim so a mismatch
    // is readable (run 37094359758 was red with no diff in the JSON report).
    expect(view(second), JSON.stringify({ first: rawTrials(first), second: rawTrials(second) }, undefined, 2)).toEqual(view(first))
  }, LANE_TIMEOUT_MS)
})
