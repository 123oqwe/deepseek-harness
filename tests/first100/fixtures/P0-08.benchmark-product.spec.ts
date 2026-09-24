/**
 * P0-08 redo (question 18 (a)), red-first cases R1–R6: the deterministic,
 * security and fault lanes of the harness capability benchmark run the
 * shipped product, and each standard metric is computed from those runs or
 * declared not applicable.
 *
 * Each lane runs through the benchmark's own entry, `benchmarks/harness-
 * capability/runner.ts` (what `pnpm benchmark:harness` runs), with only its
 * existing flags and with no model API configured. The report fields these
 * cases read are the contract `artifacts/laneA/a-381-p0-08-red-expectations.md`
 * states: per lane, `trials[]` with the session logs each trial harvested and
 * the argv it launched, and `metrics` keyed by the eight standard names.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STANDARD_METRICS } from '../../../benchmarks/harness-capability/report.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const runner = join(repoRoot, 'benchmarks/harness-capability/runner.ts')

/** The run seed every lane uses, and the second seed R4 compares against. */
const SEED = 20260924
const OTHER_SEED = 20260925
/** The lanes acceptance[0] requires to run without an external API. */
const KEYLESS_LANES = ['deterministic', 'security', 'fault'] as const
/** The two metrics with no shipped producer, which must say so rather than report a number. */
const NOT_APPLICABLE = ['verification_precision', 'router_regret'] as const
/** Deadline for one lane run: the redone lanes launch real product processes. */
const LANE_TIMEOUT_MS = 20 * 60_000

/** One trial as the contract reports it. */
interface Trial {
  readonly scenario?: unknown
  readonly seed?: unknown
  readonly sessionLogs?: readonly { readonly digest?: unknown }[]
  readonly launch?: { readonly argv?: readonly unknown[] }
  readonly failure?: unknown
}

/** One metric as the contract reports it. */
type Metric = { readonly value?: unknown; readonly n?: unknown; readonly source?: unknown; readonly ci?: { readonly lower?: unknown; readonly upper?: unknown }; readonly notApplicable?: unknown }

/** One lane's report, as far as these cases read it. */
interface LaneReport {
  readonly lane?: unknown
  readonly trials?: readonly Trial[]
  readonly metrics?: Readonly<Record<string, Metric>>
}

/** One run of the benchmark entry. */
interface Run {
  readonly exitCode: number | undefined
  readonly report: { readonly reports?: readonly LaneReport[]; readonly invariantsHeld?: unknown } | undefined
  readonly stderr: string
}

/** The environment with no model API configured. */
const keylessEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => name !== 'DEEPSEEK_API_KEY' && name !== 'DEEPSEEK_BASE_URL'))

const outDirs: string[] = []

/**
 * Run one lane through the benchmark entry and read its report.
 * @param lane - the lane to run.
 * @param seed - the run seed.
 * @returns how the run exited and what it reported.
 */
async function runLane(lane: string, seed: number): Promise<Run> {
  const out = await mkdtemp(join(tmpdir(), `dsh-p008-${lane}-`))
  outDirs.push(out)
  const result = await execa(process.execPath, ['--import', 'tsx/esm', runner, '--lane', lane, '--seed', String(seed), '--out', out], {
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
    // A run that wrote no report is recorded as having none; the control case names it.
    report = undefined
  }
  return { exitCode: result.exitCode, report, stderr: result.stderr }
}

/**
 * The one lane report a single-lane run wrote.
 * @param run - the run.
 * @returns its lane report, or an empty one.
 */
function laneOf(run: Run | undefined): LaneReport {
  return run?.report?.reports?.[0] ?? {}
}

const runs = new Map<string, Run>()
let repeat: Run | undefined
let otherSeed: Run | undefined

beforeAll(async () => {
  for (const lane of KEYLESS_LANES) runs.set(lane, await runLane(lane, SEED))
  repeat = await runLane('deterministic', SEED)
  otherSeed = await runLane('deterministic', OTHER_SEED)
}, 5 * LANE_TIMEOUT_MS)

afterAll(async () => {
  await Promise.all(outDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

describe('P0-08 redo: the keyless lanes of the harness capability benchmark run the shipped product', () => {
  it('control: each keyless lane runs and writes a report for that lane', () => {
    for (const lane of KEYLESS_LANES) {
      const run = runs.get(lane)
      expect(run?.report, `${lane}: exit ${String(run?.exitCode)}; stderr tail: ${run?.stderr.slice(-400) ?? ''}`).toBeDefined()
      expect(laneOf(run).lane).toBe(lane)
    }
  })

  it('R1: every trial launched the shipped product and harvested its session logs', () => {
    for (const lane of KEYLESS_LANES) {
      const trials = laneOf(runs.get(lane)).trials ?? []
      expect(trials.length, `${lane} trials`).toBeGreaterThan(0)
      for (const trial of trials) {
        expect(trial.sessionLogs?.length ?? 0, `${lane} trial ${JSON.stringify(trial.seed)}`).toBeGreaterThan(0)
        for (const log of trial.sessionLogs ?? []) expect(log.digest).toMatch(/^[0-9a-f]{64}$/u)
        expect(trial.launch?.argv ?? []).toContain('--profile')
      }
    }
  })

  it('R2: every standard metric is either computed from the runs or declared not applicable', () => {
    for (const lane of KEYLESS_LANES) {
      const metrics = laneOf(runs.get(lane)).metrics ?? {}
      expect(Object.keys(metrics).sort(), `${lane} metric names`).toEqual([...STANDARD_METRICS].sort())
      for (const name of STANDARD_METRICS) {
        const metric = metrics[name] ?? {}
        if (metric.notApplicable !== undefined) {
          expect(typeof metric.notApplicable === 'string' && metric.notApplicable !== '', `${lane} ${name}`).toBe(true)
          continue
        }
        expect(typeof metric.value, `${lane} ${name} value`).toBe('number')
        expect(Number.isInteger(metric.n) && (metric.n as number) > 0, `${lane} ${name} n`).toBe(true)
        expect(typeof metric.source === 'string' && metric.source !== '', `${lane} ${name} source`).toBe(true)
        expect(typeof metric.ci?.lower, `${lane} ${name} ci`).toBe('number')
        expect(typeof metric.ci?.upper, `${lane} ${name} ci`).toBe('number')
      }
    }
  })

  it('R2: verification_precision and router_regret, which have no shipped producer, say so and report no number', () => {
    for (const lane of KEYLESS_LANES) {
      for (const name of NOT_APPLICABLE) {
        const metric = laneOf(runs.get(lane)).metrics?.[name]
        expect(typeof metric?.notApplicable === 'string' && metric.notApplicable !== '', `${lane} ${name}: ${JSON.stringify(metric)}`).toBe(true)
        expect(metric?.value, `${lane} ${name}`).toBeUndefined()
      }
    }
  })

  it('R3: on the shipped product the invariant metrics are computed and show no bypass and no duplicate', () => {
    const security = laneOf(runs.get('security')).metrics
    const fault = laneOf(runs.get('fault')).metrics
    expect(security?.policy_bypass?.value, JSON.stringify(security?.policy_bypass)).toBe(0)
    expect(fault?.duplicate_side_effect?.value, JSON.stringify(fault?.duplicate_side_effect)).toBe(0)
    expect(typeof fault?.recovery_success?.value, JSON.stringify(fault?.recovery_success)).toBe('number')
  })

  it('R4: the same seed reproduces each trial, its session-log digests and its failure position', () => {
    const first = laneOf(runs.get('deterministic')).trials ?? []
    const second = laneOf(repeat).trials ?? []
    expect(first.length).toBeGreaterThan(0)
    const view = (trials: readonly Trial[]): unknown[] => trials.map(trial => ({
      scenario: trial.scenario,
      seed: trial.seed,
      digests: (trial.sessionLogs ?? []).map(log => log.digest),
      failure: trial.failure ?? null,
    }))
    expect(view(second)).toEqual(view(first))
  })

  it('R4: a different seed draws different trials', () => {
    const seeds = (run: Run | undefined): unknown[] => (laneOf(run).trials ?? []).map(trial => trial.seed)
    expect(seeds(runs.get('deterministic')).length).toBeGreaterThan(0)
    expect(seeds(otherSeed)).not.toEqual(seeds(runs.get('deterministic')))
  })

  it('R5: with no model API configured, every keyless lane still runs the product in every trial', () => {
    for (const lane of KEYLESS_LANES) {
      const trials = laneOf(runs.get(lane)).trials ?? []
      expect(trials.length, lane).toBeGreaterThan(0)
      expect(trials.every(trial => (trial.sessionLogs?.length ?? 0) > 0), lane).toBe(true)
    }
  })

  it('R6: a run exits non-zero exactly when its invariants were breached', () => {
    for (const run of [...runs.values(), repeat, otherSeed]) {
      const held = run?.report?.invariantsHeld
      expect(typeof held, JSON.stringify(run?.report?.reports?.map(report => report.lane))).toBe('boolean')
      expect(run?.exitCode === 0, `invariantsHeld ${String(held)}, exit ${String(run?.exitCode)}`).toBe(held === true)
    }
  })
})
