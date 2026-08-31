/**
 * First-100 report aggregator (R0-4, decision package §5.2 rule 1).
 *
 * Scans the observation files under `.artifacts/first100/observations/`, maps
 * each filename to its (issue, lane), re-derives every issue verdict by
 * re-running `verifyObservation` over the raw observations + frozen SHA, and
 * writes a signed `verdicts.json`. All 4 lanes are required for ACCEPTED;
 * unrun issues are NOT_RUN, never PASS/ACCEPTED.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadPinnedIdentity, resolveRepoRoot } from './common.ts'
import {
  OBSERVATIONS_DIR,
  LANES,
  type Lane,
  type Registry,
  type VerdictStatus,
} from './common.ts'
import { frozenBaseline, type RawObservation } from './issue-runner.ts'
import { verifyObservation, type Verdict, type VerifyOptions } from './verify.ts'
import { signObservation } from './attest.ts'

export type LaneState = VerdictStatus | 'ABSENT'

export interface IssueVerdict {
  id: string
  status: VerdictStatus
  lanes: Record<Lane, LaneState>
  reasons: string[]
}

export interface AggregateOptions {
  publicKeyPem: string
  repoRoot?: string
  observationsDir?: string
  fixtureResolver?: (id: string, lane: Lane) => string
  /** Canonical command expectation (defaults to the registry-derived lane command). */
  expectedCommandResolver?: (id: string, lane: Lane) => string
  /** Candidate HEAD the observed world states must bind to (default: current HEAD). */
  expectedHead?: string
  /** Candidate tree the observed world states must bind to (default: tree of expectedHead). */
  expectedTree?: string
}

const FILENAME_PATTERN = /^([P][0-8]-\d{2})\.(contract|provider|composition|fault)\.json$/

/** Observation files currently on disk (gitignored under .artifacts/). */
export function scanObservationFiles(repoRoot: string, dir = OBSERVATIONS_DIR): string[] {
  const dirPath = join(repoRoot, dir)
  if (!existsSync(dirPath)) return []
  return readdirSync(dirPath).filter(file => FILENAME_PATTERN.test(file))
}

/** Re-derive a per-issue verdict for every registry id from raw observation files. */
export function aggregate(schema: Record<string, unknown>, reg: Registry, opts: AggregateOptions): IssueVerdict[] {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot()
  const dirPath = join(repoRoot, opts.observationsDir ?? OBSERVATIONS_DIR)
  const byLane = new Map<string, Verdict>()
  for (const file of scanObservationFiles(repoRoot, opts.observationsDir ?? OBSERVATIONS_DIR)) {
    const m = FILENAME_PATTERN.exec(file)
    if (m === null) continue
    const id = m[1] ?? ''
    const lane = m[2] as Lane
    const observation = JSON.parse(readFileSync(join(dirPath, file), 'utf8')) as RawObservation
    const verifyOpts: VerifyOptions = { publicKeyPem: opts.publicKeyPem, repoRoot }
    if (opts.fixtureResolver !== undefined) verifyOpts.fixtureResolver = opts.fixtureResolver
    if (opts.expectedCommandResolver !== undefined) verifyOpts.expectedCommandResolver = opts.expectedCommandResolver
    if (opts.expectedHead !== undefined) verifyOpts.expectedHead = opts.expectedHead
    if (opts.expectedTree !== undefined) verifyOpts.expectedTree = opts.expectedTree
    let verdict: Verdict
    if (observation.id !== id || observation.lane !== lane) {
      verdict = {
        status: 'REJECTED',
        reasons: [`filename: ${file} does not match the observation id/lane (${observation.id}/${observation.lane})`],
      }
    } else {
      verdict = verifyObservation(schema, reg, observation, verifyOpts)
    }
    byLane.set(`${id}:${lane}`, verdict)
  }

  const issues: IssueVerdict[] = []
  for (const epic of reg.epics) {
    const lanes = {} as Record<Lane, LaneState>
    const reasons: string[] = []
    for (const lane of LANES) {
      const verdict = byLane.get(`${epic.id}:${lane}`)
      if (verdict === undefined) {
        lanes[lane] = 'ABSENT'
        continue
      }
      lanes[lane] = verdict.status
      reasons.push(...verdict.reasons)
    }
    // Fail-closed: REJECTED evidence anywhere invalidates the issue; ACCEPTED
    // requires all 4 lanes; a genuine FAIL or BLOCKED surfaces as such; partial
    // coverage (e.g. 1/4 attested) can never be ACCEPTED.
    const present = LANES.filter(lane => lanes[lane] !== 'ABSENT')
    let status: VerdictStatus
    if (present.length === 0) status = 'NOT_RUN'
    else if (present.some(lane => lanes[lane] === 'REJECTED')) status = 'REJECTED'
    else if (present.length === LANES.length && present.every(lane => lanes[lane] === 'ACCEPTED')) status = 'ACCEPTED'
    else if (present.some(lane => lanes[lane] === 'FAIL')) status = 'FAIL'
    else if (present.some(lane => lanes[lane] === 'BLOCKED')) status = 'BLOCKED'
    else status = 'NOT_RUN'
    issues.push({ id: epic.id, status, lanes, reasons })
  }
  return issues
}

export interface VerdictsReport {
  schema: string
  baselineSha: string
  summary: Record<VerdictStatus, number>
  perIssue: IssueVerdict[]
  signature: string
}

export type UnsignedVerdictsReport = Omit<VerdictsReport, 'signature'>

/** Count issues per verdict status. */
export function summarize(issues: IssueVerdict[]): Record<VerdictStatus, number> {
  const summary: Record<VerdictStatus, number> = { ACCEPTED: 0, FAIL: 0, NOT_RUN: 0, BLOCKED: 0, REJECTED: 0 }
  for (const issue of issues) summary[issue.status] += 1
  return summary
}

/** Build the report body (unsigned) from aggregate results. */
export function buildVerdictsReport(reg: Registry, issues: IssueVerdict[]): UnsignedVerdictsReport {
  return { schema: 'first100-verdicts-v1', baselineSha: frozenBaseline(reg), summary: summarize(issues), perIssue: issues }
}

/** Attach a detached Ed25519 signature over the canonical report body. */
export function signVerdictsReport(report: UnsignedVerdictsReport, privateKeyPem: string): string {
  return signObservation(privateKeyPem, report)
}

export interface ReportResult {
  ok: boolean
  report: VerdictsReport
  rejectedCount: number
}

/** Scan + verify + aggregate + write + sign a verdicts.json (gitignored). */
export function writeVerdictsReport(
  schema: Record<string, unknown>,
  reg: Registry,
  opts: AggregateOptions,
  privateKeyPem: string | null,
  repoRoot = resolveRepoRoot(),
): ReportResult {
  const issues = aggregate(schema, reg, opts)
  const body = buildVerdictsReport(reg, issues)
  const report: VerdictsReport = {
    ...body,
    signature: privateKeyPem === null ? '' : signVerdictsReport(body, privateKeyPem),
  }
  const dir = join(repoRoot, '.artifacts/first100')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'verdicts.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { ok: report.summary.REJECTED === 0, report, rejectedCount: report.summary.REJECTED }
}

// CLI
const args = process.argv.slice(2)
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = resolveRepoRoot()
  const reg = JSON.parse(readFileSync(join(repoRoot, 'tests/first100/registry.json'), 'utf8')) as Registry
  const schema = JSON.parse(readFileSync(join(repoRoot, 'spec/first100-evidence.schema.json'), 'utf8')) as Record<string, unknown>
  if (args[0] === 'verify') {
    let publicKeyPem: string
    try {
      publicKeyPem = loadPinnedIdentity(repoRoot).publicKeyPem
    } catch {
      console.error('VERIFY: FAIL - no pinned trusted identity at tests/first100/trusted-identity.json (run attest.ts --generate-identity)')
      process.exit(1)
    }
    const result = writeVerdictsReport(schema, reg, { publicKeyPem, repoRoot }, null, repoRoot)
    const summary = result.report.summary
    console.log(`VERIFY: wrote .artifacts/first100/verdicts.json at baseline ${result.report.baselineSha}`)
    console.log(`summary: ACCEPTED ${summary.ACCEPTED} FAIL ${summary.FAIL} NOT_RUN ${summary.NOT_RUN} BLOCKED ${summary.BLOCKED} REJECTED ${summary.REJECTED}`)
    if (result.ok) {
      console.log('VERIFY: PASS - no integrity violation (unrun issues are NOT_RUN, never PASS)')
      process.exit(0)
    }
    console.error(`VERIFY: FAIL - ${result.rejectedCount} REJECTED observation(s)`)
    process.exit(1)
  }
  console.error('usage: report.ts verify')
  process.exit(1)
}
