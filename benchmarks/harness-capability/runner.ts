/**
 * Lane runner for the Harness capability benchmark (Epic P0-08).
 *
 * `pnpm benchmark:harness [--lane <name>]... [--seed <n>] [--out <dir>]` runs
 * the requested keyless lanes, every trial of which launches the shipped
 * product with no model API configured (acceptance[0], question 18 (a)), and
 * writes `report.json` and `report.md` to `--out`. The same seed draws the
 * same trials and reproduces their normalized session logs (acceptance[1]).
 * The run exits 0 exactly when its base invariants held, 1 when a lane
 * breached one or a known-red scenario passed, and 2 when a requested lane has
 * no scenario or `--seed` is not an integer in [0, 2^32).
 * @module benchmarks/harness-capability/runner
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { runDeterministicLane } from './lanes/deterministic.ts'
import { runSecurityLane } from './lanes/security.ts'
import { readManifest, type Manifest, type ManifestLane } from './manifest.ts'
import { invariantsHeld, type LaneReport, type Metric } from './report.ts'

/** The keyless lanes that have scenarios, each with the function that runs it. */
const LANES: Readonly<Record<string, (lane: ManifestLane, seed: number, manifest: Manifest) => LaneReport | Promise<LaneReport>>> = {
  deterministic: runDeterministicLane,
  security: runSecurityLane,
}

/** Seed used when `--seed` is absent, so the registered command is reproducible as typed. */
const DEFAULT_SEED = 20260904

/**
 * One metric as one line of `report.md`.
 * @param name - the metric's name.
 * @param metric - its value or its not-applicable reason.
 * @returns the line.
 */
function metricLine(name: string, metric: Metric): string {
  if ('notApplicable' in metric) return `${name}: not applicable — ${metric.notApplicable}`
  const { value, n, source, ci } = metric
  return `${name}: ${String(value)} over ${String(n)} trials (95% CI ${String(ci.lower)}–${String(ci.upper)}) — ${source}`
}

/**
 * Run the requested lanes, one after another, and write both reports.
 * @param argv - the arguments after the script path.
 * @returns the process exit code: 0 when every base invariant held, 1 when one did not, 2 on bad arguments.
 */
async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : [...argv],
    options: { lane: { type: 'string', multiple: true }, seed: { type: 'string' }, out: { type: 'string' } },
  })
  const manifest = readManifest()
  const lanes = values.lane ?? Object.keys(LANES)
  for (const lane of lanes) {
    if (LANES[lane] === undefined || !manifest.lanes.some(declared => declared.name === lane)) {
      console.error(`benchmark:harness: no scenario in lane ${lane}`)
      return 2
    }
  }
  const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    console.error(`benchmark:harness: --seed must be an integer in [0, 2^32), got ${String(values.seed)}`)
    return 2
  }
  const reports: LaneReport[] = []
  for (const name of lanes) {
    const run = LANES[name]
    const declared = manifest.lanes.find(lane => lane.name === name)
    if (run === undefined || declared === undefined) throw new Error(`benchmark:harness: lane ${name} vanished after validation`)
    reports.push(await run(declared, seed, manifest))
  }
  const held = invariantsHeld(reports)
  const out = resolve(values.out ?? '.artifacts/benchmark')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'report.json'), `${JSON.stringify({ seed, lanes, reports, invariantsHeld: held }, null, 2)}\n`)
  const lines = reports.flatMap(report => [
    `## ${report.lane}`,
    '',
    ...Object.entries(report.metrics).map(([name, metric]) => `- ${metricLine(name, metric)}`),
    ...report.knownRed.length === 0
      ? [`- known red: none (checked against spec/first100/exec/BLOCKED-QUEUE.md on ${report.knownRedCheckedOn})`]
      : report.knownRed.map(entry => `- known red ${entry.scenario} (${entry.blocked}): ${entry.passed ? 'PASSED, which fails the run' : 'fails as expected'} — ${entry.observation}`),
    '',
  ])
  writeFileSync(join(out, 'report.md'), ['# Harness capability benchmark', '', `Seed: ${String(seed)}`, `Invariants held: ${String(held)}`, '', ...lines].join('\n'))
  console.log(`benchmark:harness: invariants ${held ? 'held' : 'BREACHED'}; reports written to ${out}`)
  return held ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2))
}
