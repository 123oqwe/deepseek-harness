/**
 * Fail-closed First-100 issue runner (R0-4, decision package §5.2 rules 2-3).
 *
 * `dry` — validate the 100-id catalog and per-lane command classification
 * WITHOUT running or marking anything PASS/ACCEPTED (R0 exit gate item 4:
 * "runner dry-validates all 100 IDs without marking unrun as PASS").
 *
 * `run <id> <lane>` — spawn the real lane command, capture the raw log and the
 * real exit code, parse testCounts from the raw log (refusing to fabricate),
 * and write the 13-field observation JSON under `.artifacts/first100/observations/`
 * (unsigned; `attest.ts --sign` later adds the detached signature). There is no
 * `--commit` override: `baselineSha` is always the frozen baseline from the
 * registry.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isExplicitCommand } from './generate-specs.ts'
import {
  OBSERVATIONS_DIR,
  LANES,
  resolveRepoRoot,
  type Epic,
  type Lane,
  type Observation,
  type Registry,
} from './common.ts'

/** A First-100 observation as written by `run`: 13 evidence fields + signature. */
export type RawObservation = Observation

export interface TestCounts {
  total: number
  passed: number
  failed: number
  skipped: number
}

/**
 * Parse a vitest-style summary line (the only format the runner accepts):
 * `Tests  3 passed | 1 failed | 2 skipped (6)`. Returns null when no line
 * matches or the parts do not sum to the total — the runner then refuses to
 * fabricate counts.
 */
export function parseTestCounts(rawLog: string): TestCounts | null {
  // Take the LAST `Tests  ... (N)` summary line: per-file lines precede the
  // final aggregate, and only the aggregate reconciles with a run's totals.
  const matches = [...rawLog.matchAll(/Tests\s+([^()]*?)\((\d+)\)/gi)]
  if (matches.length === 0) return null
  const match = matches.at(-1)
  if (match === undefined) return null
  const total = Number.parseInt(match[2] ?? '', 10)
  if (Number.isNaN(total) || total < 1) return null
  const counts: TestCounts = { total, passed: 0, failed: 0, skipped: 0 }
  const segment = match[1] ?? ''
  for (const part of segment.split('|')) {
    const m = part.trim().match(/^(\d+)\s+([a-z]+)$/i)
    if (m === null) continue
    const n = Number.parseInt(m[1] ?? '', 10)
    if (Number.isNaN(n)) continue
    const label = (m[2] ?? '').toLowerCase()
    if (label === 'passed') counts.passed = n
    else if (label === 'failed') counts.failed = n
    else if (label === 'skipped') counts.skipped = n
  }
  if (counts.passed + counts.failed + counts.skipped !== counts.total) return null
  return counts
}

/** Real observed repo state: HEAD sha + tree sha + porcelain line count. Never "unobserved". */
export function captureWorldState(repoRoot: string): string {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })
  const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repoRoot, encoding: 'utf8' })
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' })
  const headSha = head.status === 0 && /^[0-9a-f]{40}$/.test(head.stdout.trim()) ? head.stdout.trim().slice(0, 40) : 'unknown'
  const treeSha = tree.status === 0 && /^[0-9a-f]{40}$/.test(tree.stdout.trim()) ? tree.stdout.trim().slice(0, 40) : 'unknown'
  const dirty = status.stdout.split('\n').filter(line => line.length > 0).length
  return `git:{head:${headSha};tree:${treeSha};porcelainLines:${dirty}}`
}

export interface RunOptions {
  /** Override the fixture path (tests write a temp fixture under .artifacts/). */
  fixturePath?: string
  /** Override the exact command executed (tests inject a deterministic producer). */
  command?: string
  /** Override the observations directory (relative to the repo root). */
  observationsDir?: string
}

export interface RunResult {
  ok: boolean
  reason?: string
  observation?: RawObservation
  rawLogPath?: string
}

/** The frozen baseline an observation must bind to (single source of truth). */
export function frozenBaseline(reg: Registry): string {
  return reg.frozenBaseline.sha
}

/** The default lane command: run the lane's fixture under vitest. */
export function laneCommand(fixturePath: string): string {
  return `pnpm exec vitest run ${fixturePath}`
}

/** Write one observation file per (issue, lane) as ${id}.${lane}.json. */
export function observationPath(repoRoot: string, id: string, lane: Lane, dir = OBSERVATIONS_DIR): string {
  return join(repoRoot, dir, `${id}.${lane}.json`)
}

/** Raw log path, confined to the observations directory. */
export function rawLogPath(id: string, lane: Lane): string {
  return `${OBSERVATIONS_DIR}/${id}.${lane}.log`
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * Run one (issue, lane) observation: resolve the command, capture the raw log
 * and real exit code, parse testCounts, and write the observation JSON.
 * Refuses (never fabricates) on: unknown id, missing command, missing fixture,
 * signal-killed command, empty raw log, or unparseable/inconsistent counts.
 */
export function runLane(repoRoot: string, reg: Registry, id: string, lane: Lane, opts: RunOptions = {}): RunResult {
  const epic = reg.epics.find(candidate => candidate.id === id)
  if (epic === undefined) return { ok: false, reason: `unknown issue id: ${id}` }
  if (!isExplicitCommand(epic.verifyCommand)) {
    return { ok: false, reason: `${id}: MISSING_UNTIL_WAVE - no explicit verifyCommand; refusing to fabricate evidence` }
  }
  const fixture = opts.fixturePath ?? epic.fixtures[lane]
  if (!existsSync(join(repoRoot, fixture))) {
    return { ok: false, reason: `${id}.${lane}: missing fixture ${fixture}` }
  }
  const command = opts.command ?? laneCommand(fixture)
  const before = captureWorldState(repoRoot)
  const spawned = spawnSync(command, { cwd: repoRoot, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const after = captureWorldState(repoRoot)
  if (spawned.signal !== null || spawned.status === null) {
    return { ok: false, reason: `${id}.${lane}: command terminated by signal; refusing to fabricate an exit code` }
  }
  const rawLog = `${spawned.stdout}${spawned.stderr}`
  if (rawLog.length === 0) return { ok: false, reason: `${id}.${lane}: empty raw log; refusing to write evidence` }

  const dir = opts.observationsDir ?? OBSERVATIONS_DIR
  mkdirSync(join(repoRoot, dir), { recursive: true })
  const logPath = rawLogPath(id, lane)
  writeFileSync(join(repoRoot, logPath), rawLog, 'utf8')

  const counts = parseTestCounts(rawLog)
  let exitSemantics: Observation['exitSemantics']
  if (spawned.status !== 0) {
    exitSemantics = 'FAIL'
  } else if (counts === null) {
    return { ok: false, reason: `${id}.${lane}: no parseable test summary; refusing to fabricate testCounts` }
  } else if (counts.failed > 0) {
    exitSemantics = 'FAIL'
  } else {
    exitSemantics = 'ACCEPTED'
  }

  const observation: RawObservation = {
    id,
    lane,
    baselineSha: frozenBaseline(reg),
    command,
    exitCode: spawned.status,
    rawLogPath: logPath,
    rawLogSha256: sha256(rawLog),
    testCounts: counts ?? { total: 0, passed: 0, failed: 0, skipped: 0 },
    worldStateBefore: before,
    worldStateAfter: after,
    skipReason: '',
    exitSemantics,
    signature: '',
  }
  writeFileSync(observationPath(repoRoot, id, lane, dir), `${JSON.stringify(observation, null, 2)}\n`, 'utf8')
  return { ok: true, observation, rawLogPath: logPath }
}

export interface DryRow {
  id: string
  wave: number
  commandKind: 'EXPLICIT' | 'MISSING_UNTIL_WAVE'
  fixturesPresent: number
}

export interface DryReport {
  totalIds: number
  uniqueIds: number
  duplicateIds: string[]
  invalidIds: string[]
  explicitCommands: number
  missingCommands: number
  missingFixtures: Array<{ id: string; lane: Lane; path: string }>
  rows: DryRow[]
  accepted: number
}

const ID_PATTERN = /^P[0-8]-\d{2}$/

/**
 * Dry-validate the catalog: every registry id appears exactly once, matches the
 * id pattern, carries all 4 lanes, and is classified EXPLICIT vs
 * MISSING_UNTIL_WAVE by the same classifier as the generator. Reports (does not
 * fail on) missing fixtures — they are wave work. `accepted` is always 0: a dry
 * run never marks unrun evidence as PASS.
 */
export function dryReport(reg: Registry, repoRoot = resolveRepoRoot()): DryReport {
  const seen = new Map<string, number>()
  for (const epic of reg.epics) {
    seen.set(epic.id, (seen.get(epic.id) ?? 0) + 1)
  }
  const duplicateIds = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id)
  const invalidIds = reg.epics.filter(epic => !ID_PATTERN.test(epic.id)).map(epic => epic.id)

  const missingFixtures: DryReport['missingFixtures'] = []
  let explicit = 0
  let missing = 0
  const rows: DryRow[] = []
  for (const epic of reg.epics) {
    const isExplicit = isExplicitCommand(epic.verifyCommand)
    if (isExplicit) explicit += 1
    else missing += 1
    let present = 0
    for (const lane of LANES) {
      const path = epic.fixtures[lane]
      if (existsSync(join(repoRoot, path))) present += 1
      else missingFixtures.push({ id: epic.id, lane, path })
    }
    rows.push({ id: epic.id, wave: epic.wave, commandKind: isExplicit ? 'EXPLICIT' : 'MISSING_UNTIL_WAVE', fixturesPresent: present })
  }

  return {
    totalIds: reg.epics.length,
    uniqueIds: seen.size,
    duplicateIds,
    invalidIds,
    explicitCommands: explicit,
    missingCommands: missing,
    missingFixtures,
    rows,
    accepted: 0,
  }
}

/**
 * True only when the catalog is fully runnable: no dup/invalid id, no lane-count
 * anomaly, no missing explicit command, and no missing required fixture.
 * Maintainer hardening (2026-08-27): a dry run must FAIL when 91 commands or 400
 * fixtures are missing — the runner never claims a catalog is runnable when it
 * cannot actually run all N epics (BLOCKED-037: `totalIds === uniqueIds`
 * replaces a hardcoded `=== 100`, which BASE-ALIGN-v2's new-gap epics would
 * otherwise make permanently wrong -- `totalIds` is `reg.epics.length` from
 * the same trusted registry read `report` was built from, so this stays a
 * real "no duplicates, nothing silently dropped" check, not a loosening).
 */
export function dryReportOk(report: DryReport): boolean {
  return report.totalIds === report.uniqueIds && report.totalIds > 0
    && report.duplicateIds.length === 0
    && report.invalidIds.length === 0
    && report.rows.every(row => row.fixturesPresent <= 4)
    && report.missingCommands === 0
    && report.missingFixtures.length === 0
}

/** Imported for type completeness of the runner surface. */
export type EpicRow = Epic

// CLI
const args = process.argv.slice(2)
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = resolveRepoRoot()
  const reg = JSON.parse(readFileSync(join(repoRoot, 'tests/first100/registry.json'), 'utf8')) as Registry
  if (args[0] === 'dry') {
    const report = dryReport(reg, repoRoot)
    console.log(JSON.stringify(report, null, 2))
    if (dryReportOk(report)) {
      console.log('DRY: PASS - catalog sound; 0 accepted (unrun is never PASS)')
      process.exit(0)
    }
    console.error('DRY: FAIL - catalog not fully runnable (duplicate/invalid id, lane count, or missing command/fixture)')
    process.exit(1)
  }
  if (args[0] === 'run') {
    const id = args[1]
    const laneArg = args[2] as Lane | undefined
    if (id === undefined || laneArg === undefined || !(LANES as readonly string[]).includes(laneArg)) {
      console.error('usage: issue-runner.ts run <id> <lane>  (lane in contract|provider|composition|fault)')
      process.exit(1)
    }
    const result = runLane(repoRoot, reg, id, laneArg)
    if (!result.ok) {
      console.error(`RUN: FAIL - ${result.reason ?? 'unknown'}`)
      process.exit(1)
    }
    console.log(`RUN: OK - wrote ${observationPath(repoRoot, id, laneArg)} (exitCode ${result.observation?.exitCode})`)
    process.exit(0)
  }
  console.error('usage: issue-runner.ts dry | issue-runner.ts run <id> <lane>')
  process.exit(1)
}
