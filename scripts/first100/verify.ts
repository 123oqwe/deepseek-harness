/**
 * Fail-closed First-100 verifier (R0-4, decision package §5.2 rules 1-3).
 *
 * `verifyObservation` independently re-checks every evidence field: the
 * committed schema (ajv draft-07), the detached Ed25519 attestation against the
 * pinned trusted identity, the frozen baseline, the testCounts sum, the
 * non-empty skipReason / "unobserved" world-state rejection rules, and the
 * on-disk raw log (existence, non-zero size, sha256). A model/executor
 * self-report never constitutes evidence: exitSemantics is re-derived from the
 * raw evidence and must match the observation's claim.
 *
 * Maintainer hardening (2026-08-27): the raw log is re-parsed and its last
 * aggregate summary must reconcile EXACTLY with the claimed testCounts; ACCEPTED
 * requires passed>0 AND failed=0 AND skipped=0; the recorded command must be the
 * canonical registry-derived lane command; and both world states must parse to a
 * well-formed 40-hex HEAD + tree at the candidate SHA with porcelainLines=0
 * (dirty / stale / unknown are all rejected).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import Ajv from 'ajv'

import { verifyObservationSignature } from './attest.ts'
import {
  LANES,
  OBSERVATIONS_DIR,
  resolveRepoRoot,
  type Lane,
  type Observation,
  type Registry,
  type VerdictStatus,
} from './common.ts'
import { frozenBaseline, laneCommand, parseTestCounts, type RawObservation } from './issue-runner.ts'

export interface Verdict {
  status: VerdictStatus
  reasons: string[]
}

/** Validate a value against a JSON Schema (draft-07 via ajv); returns error strings. */
export function validateAgainstSchema(schema: Record<string, unknown>, value: unknown): string[] {
  const ajv = new Ajv({ allErrors: true })
  // `schemaVersion` is a versioning metadata field (annotation-only), not a
  // validation keyword. Whitelisting it keeps strict mode on for every OTHER
  // unknown keyword, so an unreadable schema still fails closed.
  ajv.addVocabulary(['schemaVersion'])
  const validate = ajv.compile(schema)
  if (validate(value)) return []
  return (validate.errors ?? []).map(
    error => `${error.instancePath} ${error.message ?? ''}`.trim(),
  )
}

/**
 * Re-derive the exit semantics from the raw evidence alone. `null` means the
 * evidence is self-contradictory (exit 0 alongside failing/absent/skipped-only
 * tests). ACCEPTED requires passed>0, failed=0, skipped=0, total===passed.
 */
export function deriveExpectedSemantics(
  observation: Pick<Observation, 'exitCode' | 'testCounts'>,
): 'ACCEPTED' | 'FAIL' | 'NOT_RUN' | null {
  if (observation.exitCode === null) return 'NOT_RUN'
  if (observation.exitCode !== 0) return 'FAIL'
  const c = observation.testCounts
  if (c.passed < 1 || c.failed !== 0 || c.skipped !== 0 || c.total !== c.passed) return null
  return 'ACCEPTED'
}

/** Parsed `git:{head;tree;porcelainLines}` world-state record. */
export interface WorldState {
  head: string
  tree: string
  porcelain: number
}

/** Parse a captured world state; null when malformed or HEAD/tree is 'unknown'. */
export function parseWorldState(state: string): WorldState | null {
  const m = /^git:\{head:([0-9a-f]{40});tree:([0-9a-f]{40});porcelainLines:(\d+)\}$/.exec(state)
  if (m === null) return null
  const head = m[1]
  const tree = m[2]
  const porcelain = m[3]
  if (head === undefined || tree === undefined || porcelain === undefined) return null
  return { head, tree, porcelain: Number.parseInt(porcelain, 10) }
}

/** The current repo HEAD sha ('' when unparseable). */
export function currentRepoHead(repoRoot: string): string {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })
  const sha = head.status === 0 ? head.stdout.trim() : ''
  return /^[0-9a-f]{40}$/.test(sha) ? sha : ''
}

/** The tree object sha of a commit ('' when unparseable). */
export function treeOfCommit(repoRoot: string, head: string): string {
  const tree = spawnSync('git', ['rev-parse', `${head}^{tree}`], { cwd: repoRoot, encoding: 'utf8' })
  const t = tree.status === 0 ? tree.stdout.trim() : ''
  return /^[0-9a-f]{40}$/.test(t) ? t : ''
}

export interface VerifyOptions {
  /** Public key PEM of the pinned trusted identity. */
  publicKeyPem: string
  /** Resolve the fixture backing an ACCEPTED claim (default: the registry path). */
  fixtureResolver?: (id: string, lane: Lane) => string
  /** Resolve the canonical command the observation must have recorded. */
  expectedCommandResolver?: (id: string, lane: Lane) => string
  /** The candidate HEAD the observed world state must bind to (default: current HEAD). */
  expectedHead?: string
  /** The candidate tree the observed world state must bind to (default: tree of expectedHead). */
  expectedTree?: string
  repoRoot?: string
}

/** Verify one observation fail-closed; REJECTED on the first integrity failure. */
export function verifyObservation(
  schema: Record<string, unknown>,
  reg: Registry,
  observation: RawObservation,
  opts: VerifyOptions,
): Verdict {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot()
  const schemaErrors = validateAgainstSchema(schema, observation)
  if (schemaErrors.length > 0) {
    return { status: 'REJECTED', reasons: schemaErrors.map(error => `schema: ${error}`) }
  }
  if (!verifyObservationSignature(opts.publicKeyPem, observation as unknown as Record<string, unknown>)) {
    return { status: 'REJECTED', reasons: ['signature: detached attestation does not verify against the pinned trusted identity'] }
  }
  if (observation.baselineSha !== frozenBaseline(reg)) {
    return { status: 'REJECTED', reasons: ['baseline: observation binds to a non-frozen SHA'] }
  }
  const epic = reg.epics.find(candidate => candidate.id === observation.id)
  if (epic === undefined) return { status: 'REJECTED', reasons: ['id: unknown issue id in the canonical registry'] }
  const counts = observation.testCounts
  if (counts.total < 1 || counts.passed + counts.failed + counts.skipped !== counts.total) {
    return { status: 'REJECTED', reasons: ['testCounts: passed+failed+skipped must equal total with total>=1 (fabrication rejected)'] }
  }
  if (observation.skipReason.length > 0) {
    return { status: 'REJECTED', reasons: ['skipReason: must be empty; a non-empty skipReason is rejected, never injected'] }
  }
  if (observation.worldStateBefore === 'unobserved' || observation.worldStateAfter === 'unobserved') {
    return { status: 'REJECTED', reasons: ['worldState: "unobserved" is rejected'] }
  }
  const rawLogPath = observation.rawLogPath
  if (!rawLogPath.startsWith(`${OBSERVATIONS_DIR}/`) || rawLogPath.includes('..')) {
    return { status: 'REJECTED', reasons: ['rawLogPath: confined to .artifacts/first100/observations/'] }
  }
  let rawBytes: Buffer
  try {
    const stat = statSync(join(repoRoot, rawLogPath))
    if (stat.size === 0) return { status: 'REJECTED', reasons: ['rawLog: empty; non-zero size required'] }
    rawBytes = readFileSync(join(repoRoot, rawLogPath))
  } catch {
    return { status: 'REJECTED', reasons: ['rawLog: missing under the observations directory'] }
  }
  if (createHash('sha256').update(rawBytes).digest('hex') !== observation.rawLogSha256) {
    return { status: 'REJECTED', reasons: ['rawLogSha256: digest mismatch with the raw log bytes'] }
  }
  // Raw-log reconcile: independently re-parse the last aggregate vitest summary
  // and require it to EXACTLY equal the claimed testCounts. A claimed count that
  // does not match the log is fabrication; an unparseable log cannot back a
  // schema-valid (total>=1) claim.
  const parsedCounts = parseTestCounts(rawBytes.toString('utf8'))
  if (
    parsedCounts === null
    || parsedCounts.total !== counts.total
    || parsedCounts.passed !== counts.passed
    || parsedCounts.failed !== counts.failed
    || parsedCounts.skipped !== counts.skipped
  ) {
    return { status: 'REJECTED', reasons: ['testCounts: raw-log re-parse does not reconcile with the claimed testCounts (fabrication rejected)'] }
  }
  // Canonical command: the recorded command must be the registry-derived lane
  // command for this (id, lane), or the explicitly declared expected command.
  const fixture = opts.fixtureResolver !== undefined
    ? opts.fixtureResolver(observation.id, observation.lane)
    : epic.fixtures[observation.lane]
  const expectedCommand = opts.expectedCommandResolver !== undefined
    ? opts.expectedCommandResolver(observation.id, observation.lane)
    : laneCommand(fixture)
  if (observation.command !== expectedCommand) {
    return { status: 'REJECTED', reasons: [`command: recorded ${JSON.stringify(observation.command)} is not the canonical command for ${observation.id}.${observation.lane}`] }
  }
  // Strict world state: before and after must both parse to a well-formed
  // 40-hex HEAD + tree at the candidate SHA with a fully clean tree. Dirty
  // (porcelain>0), stale (HEAD != candidate), and unknown/malformed are rejected.
  const expectedHead = opts.expectedHead !== undefined ? opts.expectedHead : currentRepoHead(repoRoot)
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) {
    return { status: 'REJECTED', reasons: ['worldState: cannot resolve the candidate HEAD for verification'] }
  }
  const expectedTree = opts.expectedTree !== undefined ? opts.expectedTree : treeOfCommit(repoRoot, expectedHead)
  for (const key of ['worldStateBefore', 'worldStateAfter'] as const) {
    const parsed = parseWorldState(observation[key])
    if (parsed === null) {
      return { status: 'REJECTED', reasons: [`worldState: ${key} is malformed/unknown (expected git:{head;tree;porcelainLines})`] }
    }
    if (parsed.porcelain !== 0) {
      return { status: 'REJECTED', reasons: [`worldState: ${key} shows a dirty tree (porcelainLines ${parsed.porcelain} > 0)`] }
    }
    if (parsed.head !== expectedHead) {
      return { status: 'REJECTED', reasons: [`worldState: ${key} head ${parsed.head} is stale (expected ${expectedHead})`] }
    }
    if (parsed.tree !== expectedTree) {
      return { status: 'REJECTED', reasons: [`worldState: ${key} tree ${parsed.tree} does not match the candidate tree ${expectedTree}`] }
    }
  }
  const derived = deriveExpectedSemantics(observation)
  if (derived === null) {
    return { status: 'REJECTED', reasons: ['exitSemantics: exit code 0 cannot coexist with failing, absent, or skipped-only tests'] }
  }
  if (derived !== observation.exitSemantics) {
    return {
      status: 'REJECTED',
      reasons: [`exitSemantics: claimed ${observation.exitSemantics} but evidence implies ${derived} (self-report never constitutes evidence)`],
    }
  }
  if (observation.exitSemantics === 'ACCEPTED') {
    if (!existsSync(join(repoRoot, fixture))) {
      return { status: 'REJECTED', reasons: [`fixture: missing for an ACCEPTED claim (${fixture})`] }
    }
  }
  return { status: derived, reasons: [] }
}

/** The four evidence lanes required per issue (re-exported for report.ts). */
export const REQUIRED_LANES = LANES
