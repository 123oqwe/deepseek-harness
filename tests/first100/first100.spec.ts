/**
 * R0-4 fail-closed runner/verifier tests (decision package §5.2 rule 4 + R0-6
 * negative controls). Every rejection rule is proven by a focused negative test
 * that FAILS on a deliberately mutated observation and the genuine pipeline
 * passes the positive tests. Zero slack: forged signature, unknown baseline,
 * fabricated counts, skipReason set, missing lane, "unobserved" world,
 * path-traversal rawLogPath, empty raw log, and missing fixture are all
 * rejected — never silently accepted.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { signObservation, verifyObservationSignature } from '../../scripts/first100/attest.ts'
import { resolveRepoRoot, type Lane, type Registry } from '../../scripts/first100/common.ts'
import {
  dryReport,
  dryReportOk,
  parseTestCounts,
  runLane,
  type RawObservation,
} from '../../scripts/first100/issue-runner.ts'
import { aggregate, type IssueVerdict } from '../../scripts/first100/report.ts'
import { deriveExpectedSemantics, verifyObservation } from '../../scripts/first100/verify.ts'

const repoRoot = resolveRepoRoot()
const reg = JSON.parse(readFileSync(join(repoRoot, 'tests/first100/registry.json'), 'utf8')) as Registry
const schema = JSON.parse(readFileSync(join(repoRoot, 'spec/first100-evidence.schema.json'), 'utf8')) as Record<string, unknown>

const RAW_LOG = 'Tests  1 passed (1)\n'
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** The canonical command every test observation records. */
const CANONICAL_PRINTF = 'printf "Tests  1 passed (1)\\n"'

/** Current repo HEAD/tree, for a world state that binds to the candidate. */
const repoSha = (arg: string): string => {
  const r = spawnSync('git', ['rev-parse', arg], { cwd: repoRoot, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}
const REAL_HEAD = repoSha('HEAD')
const REAL_TREE = repoSha('HEAD^{tree}')
const realWorldState = (): string => `git:{head:${REAL_HEAD};tree:${REAL_TREE};porcelainLines:0}`

interface KeyPair {
  publicKeyPem: string
  privateKeyPem: string
}

function makeKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

const cleanedPaths: string[] = []
afterEach(() => {
  for (const path of cleanedPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

function track(path: string): string {
  cleanedPaths.push(path)
  return path
}

/** Write a raw log on disk and return its relative path. */
function writeRawLog(id: string, lane: Lane, content = RAW_LOG): string {
  const rel = `.artifacts/first100/observations/${id}.${lane}.log`
  const abs = join(repoRoot, rel)
  mkdirSync(dirname(abs), { recursive: true })
  track(abs)
  writeFileSync(abs, content, 'utf8')
  return rel
}

interface BuildOptions {
  reg: Registry
  keyPair: KeyPair
  id?: string
  lane?: Lane
  rawLogContent?: string
  rawLogRelativePath?: string
  writeLog?: boolean
  overrides?: Partial<RawObservation>
}

/** Build a genuinely-signed ACCEPTED observation backed by a real raw log. */
function buildObservation(opts: BuildOptions): RawObservation {
  const { keyPair, id = 'P0-01', lane = 'contract' } = opts
  const rawLogContent = opts.rawLogContent ?? RAW_LOG
  const rawLogRelativePath = opts.rawLogRelativePath ?? `.artifacts/first100/observations/${id}.${lane}.log`
  if (opts.writeLog !== false) {
    const abs = join(repoRoot, rawLogRelativePath)
    mkdirSync(dirname(abs), { recursive: true })
    track(abs)
    writeFileSync(abs, rawLogContent, 'utf8')
  }
  const observation: RawObservation = {
    id,
    lane,
    baselineSha: opts.reg.frozenBaseline.sha,
    command: CANONICAL_PRINTF,
    exitCode: 0,
    rawLogPath: rawLogRelativePath,
    rawLogSha256: sha256(rawLogContent),
    testCounts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    worldStateBefore: realWorldState(),
    worldStateAfter: realWorldState(),
    skipReason: '',
    exitSemantics: 'ACCEPTED',
    signature: '',
    ...opts.overrides,
  }
  observation.signature = signObservation(keyPair.privateKeyPem, observation as unknown as Record<string, unknown>)
  return observation
}

function writeObservationFile(relDir: string, observation: RawObservation): void {
  const abs = join(repoRoot, relDir, `${observation.id}.${observation.lane}.json`)
  mkdirSync(dirname(abs), { recursive: true })
  track(abs)
  writeFileSync(abs, JSON.stringify(observation, null, 2), 'utf8')
}

/** A temp fixture file that actually exists (backing an ACCEPTED claim). */
function tempFixture(id: string): string {
  const rel = `.artifacts/first100/observations/_fixtures/${id}.contract.spec.ts`
  const abs = join(repoRoot, rel)
  mkdirSync(dirname(abs), { recursive: true })
  track(abs)
  writeFileSync(abs, 'export const fixture = true\n', 'utf8')
  return rel
}

describe('issue-runner dry catalog', () => {
  it('dry-catalogs all 100 IDs but FAILS while commands/fixtures are missing (never a false PASS)', () => {
    const report = dryReport(reg, repoRoot)
    expect(report.totalIds).toBe(100)
    expect(report.uniqueIds).toBe(100)
    expect(report.duplicateIds).toEqual([])
    expect(report.invalidIds).toEqual([])
    expect(report.explicitCommands).toBe(9)
    expect(report.missingCommands).toBe(91)
    expect(report.accepted).toBe(0)
    expect(report.rows.length).toBe(100)
    // Maintainer hardening (2026-08-27): 91 missing commands / 400 missing
    // fixtures must NOT output PASS — the runner never claims a catalog it
    // cannot actually run.
    expect(report.missingFixtures.length).toBeGreaterThan(0)
    expect(dryReportOk(report)).toBe(false)
  })

  it('dry fails when a required fixture is missing', () => {
    const minimal = {
      ...reg,
      epics: [{
        ...reg.epics[0]!,
        verifyCommand: 'echo test',
        fixtures: {
          contract: 'does-not-exist.spec.ts',
          provider: 'does-not-exist.spec.ts',
          composition: 'does-not-exist.spec.ts',
          fault: 'does-not-exist.spec.ts',
        },
      }],
    }
    const report = dryReport(minimal, repoRoot)
    expect(report.explicitCommands).toBe(1)
    expect(report.missingCommands).toBe(0)
    expect(report.missingFixtures.length).toBe(4)
    expect(dryReportOk(report)).toBe(false)
  })

  it('dry rejects a duplicate id', () => {
    const dup = { ...reg, epics: [...reg.epics, reg.epics[0]!] }
    const report = dryReport(dup, repoRoot)
    expect(report.totalIds).toBe(101)
    expect(report.uniqueIds).toBe(100)
    expect(report.duplicateIds).toContain('P0-01')
    expect(dryReportOk(report)).toBe(false)
  })

  it('dry rejects an out-of-pattern id', () => {
    const bad = { ...reg, epics: reg.epics.map((epic, i) => (i === 0 ? { ...epic, id: 'X-01' } : epic)) }
    const report = dryReport(bad, repoRoot)
    expect(report.invalidIds).toContain('X-01')
    expect(dryReportOk(report)).toBe(false)
  })
})

describe('parseTestCounts', () => {
  it('parses a genuine vitest summary', () => {
    expect(parseTestCounts('Test Files  1 passed (1)\nTests  3 passed | 1 failed | 2 skipped (6)\n')).toEqual({
      total: 6,
      passed: 3,
      failed: 1,
      skipped: 2,
    })
    expect(parseTestCounts('Tests  1 passed (1)\n')).toEqual({ total: 1, passed: 1, failed: 0, skipped: 0 })
  })

  it('refuses an inconsistent, empty, or absent summary', () => {
    expect(parseTestCounts('Tests  2 passed | 1 failed (5)\n')).toBeNull()
    expect(parseTestCounts('')).toBeNull()
    expect(parseTestCounts('no summary here')).toBeNull()
  })
})

describe('verifyObservation fail-closed rules', () => {
  const keys = makeKeyPair()

  it('derives semantics from evidence, not the self-report', () => {
    expect(deriveExpectedSemantics({ exitCode: 0, testCounts: { total: 2, passed: 2, failed: 0, skipped: 0 } })).toBe('ACCEPTED')
    expect(deriveExpectedSemantics({ exitCode: 1, testCounts: { total: 2, passed: 2, failed: 0, skipped: 0 } })).toBe('FAIL')
    expect(deriveExpectedSemantics({ exitCode: null, testCounts: { total: 0, passed: 0, failed: 0, skipped: 0 } })).toBe('NOT_RUN')
    expect(deriveExpectedSemantics({ exitCode: 0, testCounts: { total: 2, passed: 1, failed: 1, skipped: 0 } })).toBeNull()
  })

  it('signs deterministically over the canonical serialization', () => {
    const a = { x: 2, y: '1', z: [1, 'a'] }
    const b = { y: '1', z: [1, 'a'], x: 2 }
    const sigA = signObservation(keys.privateKeyPem, a)
    const sigB = signObservation(keys.privateKeyPem, b)
    expect(sigA).toBe(sigB)
    expect(verifyObservationSignature(keys.publicKeyPem, { ...a, signature: sigA })).toBe(true)
  })

  it('rejects a forged signature', () => {
    const forged = { ...buildObservation({ reg, keyPair: keys }), signature: 'ff'.repeat(64) }
    const verdict = verifyObservation(schema, reg, forged, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/signature/)
  })

  it('rejects an observation signed by a different identity', () => {
    const other = makeKeyPair()
    const verdict = verifyObservation(schema, reg, buildObservation({ reg, keyPair: keys }), {
      publicKeyPem: other.publicKeyPem,
      repoRoot,
    })
    expect(verdict.status).toBe('REJECTED')
  })

  it('rejects an unsigned observation', () => {
    const unsigned = { ...buildObservation({ reg, keyPair: keys }), signature: '' }
    const verdict = verifyObservation(schema, reg, unsigned, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
  })

  it('rejects an unknown baseline', () => {
    const bad = buildObservation({ reg, keyPair: keys, overrides: { baselineSha: 'unknown' } })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
  })

  it('rejects fabricated testCounts (sum != total)', () => {
    const bad = buildObservation({
      reg,
      keyPair: keys,
      overrides: { testCounts: { total: 5, passed: 1, failed: 1, skipped: 1 } },
    })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/testCounts/)
  })

  it('rejects a non-empty skipReason', () => {
    const bad = buildObservation({ reg, keyPair: keys, overrides: { skipReason: 'skipped' } })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
  })

  it('rejects an "unobserved" world state', () => {
    const bad = buildObservation({ reg, keyPair: keys, overrides: { worldStateBefore: 'unobserved' } })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
  })

  it('rejects a path-traversal rawLogPath', () => {
    const bad = buildObservation({
      reg,
      keyPair: keys,
      writeLog: false,
      overrides: { rawLogPath: '../escape.json', rawLogSha256: sha256('') },
    })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
  })

  it('rejects an empty raw log', () => {
    const bad = buildObservation({ reg, keyPair: keys, rawLogContent: '' })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/rawLog/)
  })

  it('rejects a missing raw log', () => {
    const bad = buildObservation({ reg, keyPair: keys, writeLog: false })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/rawLog/)
  })

  it('rejects a rawLogSha256 mismatch', () => {
    const bad = buildObservation({ reg, keyPair: keys, overrides: { rawLogSha256: '00'.repeat(32) } })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/rawLogSha256/)
  })

  it('rejects a self-reported exitSemantics contradicting the evidence (BLOCKED vs NOT_RUN)', () => {
    const bad = buildObservation({ reg, keyPair: keys, overrides: { exitCode: null, exitSemantics: 'BLOCKED' } })
    const verdict = verifyObservation(schema, reg, bad, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      expectedCommandResolver: () => CANONICAL_PRINTF,
    })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/exitSemantics/)
  })

  it('rejects exit code 0 alongside failing tests', () => {
    const bad = buildObservation({
      reg,
      keyPair: keys,
      overrides: { testCounts: { total: 1, passed: 0, failed: 1, skipped: 0 } },
    })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
  })

  it('rejects an ACCEPTED claim whose fixture is missing', () => {
    const observation = buildObservation({ reg, keyPair: keys })
    // no fixtureResolver: default resolves the registry path, which does not exist yet
    const verdict = verifyObservation(schema, reg, observation, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      expectedCommandResolver: () => CANONICAL_PRINTF,
    })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/fixture/)
  })

  it('accepts a genuinely signed, observed run backed by an existing fixture', () => {
    const fixture = tempFixture('P0-01')
    const observation = buildObservation({ reg, keyPair: keys })
    const verdict = verifyObservation(schema, reg, observation, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      fixtureResolver: () => fixture,
      expectedCommandResolver: () => CANONICAL_PRINTF,
    })
    expect(verdict.status).toBe('ACCEPTED')
    expect(verdict.reasons).toEqual([])
  })

  it('rejects a recorded command that is not the canonical lane command', () => {
    const observation = buildObservation({ reg, keyPair: keys })
    const verdict = verifyObservation(schema, reg, observation, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      fixtureResolver: () => tempFixture('P0-01'),
      expectedCommandResolver: () => 'echo not-canonical',
    })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/command/)
  })

  it('rejects a raw-log re-parse that does not reconcile with the claimed testCounts', () => {
    const bad = buildObservation({
      reg,
      keyPair: keys,
      overrides: { testCounts: { total: 2, passed: 2, failed: 0, skipped: 0 } },
    })
    const verdict = verifyObservation(schema, reg, bad, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      expectedCommandResolver: () => CANONICAL_PRINTF,
    })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/raw-log re-parse/)
  })

  it('rejects a dirty world state (porcelainLines > 0)', () => {
    const bad = buildObservation({
      reg,
      keyPair: keys,
      overrides: { worldStateBefore: `git:{head:${REAL_HEAD};tree:${REAL_TREE};porcelainLines:1}` },
    })
    const verdict = verifyObservation(schema, reg, bad, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      expectedCommandResolver: () => CANONICAL_PRINTF,
    })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/dirty/)
  })

  it('rejects a stale HEAD that does not bind to the candidate SHA', () => {
    const bad = buildObservation({
      reg,
      keyPair: keys,
      overrides: { worldStateBefore: `git:{head:${'0'.repeat(40)};tree:${REAL_TREE};porcelainLines:0}` },
    })
    const verdict = verifyObservation(schema, reg, bad, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      expectedCommandResolver: () => CANONICAL_PRINTF,
    })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/stale/)
  })

  it('rejects a stale TREE that does not match the candidate commit', () => {
    const bad = buildObservation({
      reg,
      keyPair: keys,
      overrides: { worldStateAfter: `git:{head:${REAL_HEAD};tree:${'0'.repeat(40)};porcelainLines:0}` },
    })
    const verdict = verifyObservation(schema, reg, bad, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      expectedCommandResolver: () => CANONICAL_PRINTF,
    })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/tree/)
  })

  it('rejects exit code 0 alongside skipped-only tests', () => {
    const bad = buildObservation({
      reg,
      keyPair: keys,
      rawLogContent: 'Tests  1 skipped (1)\n',
      overrides: { testCounts: { total: 1, passed: 0, failed: 0, skipped: 1 }, exitSemantics: 'ACCEPTED' },
    })
    const verdict = verifyObservation(schema, reg, bad, {
      publicKeyPem: keys.publicKeyPem,
      repoRoot,
      expectedCommandResolver: () => CANONICAL_PRINTF,
    })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/skipped-only/)
  })

  it('rejects a malformed/old world-state string at schema validation', () => {
    const bad = buildObservation({ reg, keyPair: keys, overrides: { worldStateAfter: 'git:{head:abc;porcelainLines:0}' } })
    const verdict = verifyObservation(schema, reg, bad, { publicKeyPem: keys.publicKeyPem, repoRoot })
    expect(verdict.status).toBe('REJECTED')
    expect(verdict.reasons.join(' ')).toMatch(/schema/)
  })
})

describe('issue runner (runLane)', () => {
  it('refuses a missing-command epic without fabricating evidence', () => {
    const result = runLane(repoRoot, reg, 'P0-02', 'contract')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/MISSING_UNTIL_WAVE/)
  })

  it('refuses a missing fixture', () => {
    const result = runLane(repoRoot, reg, 'P0-01', 'contract')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/missing fixture/)
  })

  it('runs a genuinely observed lane and writes a parseable, attestable observation', () => {
    const keys = makeKeyPair()
    const fixture = tempFixture('P0-01')
    try {
      const result = runLane(repoRoot, reg, 'P0-01', 'contract', {
        fixturePath: fixture,
        command: CANONICAL_PRINTF,
      })
      expect(result.ok).toBe(true)
      const observation = result.observation!
      expect(observation.exitCode).toBe(0)
      expect(observation.exitSemantics).toBe('ACCEPTED')
      expect(observation.baselineSha).toBe(reg.frozenBaseline.sha)
      expect(existsSync(join(repoRoot, observation.rawLogPath))).toBe(true)
      observation.signature = signObservation(keys.privateKeyPem, observation as unknown as Record<string, unknown>)
      const verdict = verifyObservation(schema, reg, observation, {
        publicKeyPem: keys.publicKeyPem,
        repoRoot,
        fixtureResolver: () => fixture,
        expectedCommandResolver: () => CANONICAL_PRINTF,
      })
      // The captured world state reflects the actual tree at run time: a clean
      // candidate ACCEPTs; a dirty tree is honestly REJECTED (never fabricated
      // clean). A clean CI tree hits ACCEPTED; a dirty local tree exercises the
      // dirty-rejection path on a genuinely observed run.
      if (/porcelainLines:0}/.test(observation.worldStateBefore)) {
        expect(verdict.status).toBe('ACCEPTED')
        expect(verdict.reasons).toEqual([])
      } else {
        expect(verdict.status).toBe('REJECTED')
        expect(verdict.reasons.join(' ')).toMatch(/dirty/)
      }
    } finally {
      rmSync(join(repoRoot, '.artifacts/first100/observations/P0-01.contract.log'), { force: true })
      rmSync(join(repoRoot, '.artifacts/first100/observations/P0-01.contract.json'), { force: true })
      rmSync(join(repoRoot, fixture), { force: true })
    }
  }, 20000)

  it('refuses to write evidence for an empty raw log', () => {
    const fixture = tempFixture('P0-01')
    try {
      const result = runLane(repoRoot, reg, 'P0-01', 'contract', {
        fixturePath: fixture,
        command: 'printf ""',
      })
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/empty raw log/)
    } finally {
      rmSync(join(repoRoot, fixture), { force: true })
    }
  })
})

describe('report aggregation', () => {
  const AGG_DIR = '.artifacts/first100/observations/_agg'

  it('never marks an issue ACCEPTED from a single attested lane', () => {
    const keys = makeKeyPair()
    const fixture = tempFixture('P0-01')
    const observation = buildObservation({ reg, keyPair: keys })
    writeObservationFile(AGG_DIR, observation)
    try {
      const issues = aggregate(schema, reg, {
        publicKeyPem: keys.publicKeyPem,
        repoRoot,
        observationsDir: AGG_DIR,
        fixtureResolver: () => fixture,
        expectedCommandResolver: () => CANONICAL_PRINTF,
      })
      const issue = issues.find(candidate => candidate.id === 'P0-01')!
      expect(issue.status).toBe('NOT_RUN')
      expect(issue.lanes.contract).toBe('ACCEPTED')
      expect(issue.lanes.provider).toBe('ABSENT')
      expect(issue.lanes.composition).toBe('ABSENT')
      expect(issue.lanes.fault).toBe('ABSENT')
    } finally {
      rmSync(join(repoRoot, fixture), { force: true })
    }
  })

  it('ACCEPTs an issue only when all 4 lanes are attested', () => {
    const keys = makeKeyPair()
    const fixture = tempFixture('P0-01')
    const dir = `${AGG_DIR}-full`
    try {
      for (const lane of ['contract', 'provider', 'composition', 'fault'] as Lane[]) {
        const logRel = writeRawLog('P0-01', lane)
        const observation = buildObservation({ reg, keyPair: keys, rawLogRelativePath: logRel, overrides: { lane } })
        writeObservationFile(dir, observation)
      }
      const issues = aggregate(schema, reg, {
        publicKeyPem: keys.publicKeyPem,
        repoRoot,
        observationsDir: dir,
        fixtureResolver: () => fixture,
        expectedCommandResolver: () => CANONICAL_PRINTF,
      })
      const issue = issues.find(candidate => candidate.id === 'P0-01')!
      expect(issue.status).toBe('ACCEPTED')
      expect(issue.reasons).toEqual([])
    } finally {
      rmSync(join(repoRoot, fixture), { force: true })
    }
  })

  it('rejects an observation file whose id does not match its filename', () => {
    const keys = makeKeyPair()
    const mislabeled = { ...buildObservation({ reg, keyPair: keys }), id: 'P0-02' }
    const abs = join(repoRoot, AGG_DIR, 'P0-01.contract.json')
    mkdirSync(dirname(abs), { recursive: true })
    track(abs)
    writeFileSync(abs, JSON.stringify(mislabeled, null, 2), 'utf8')
    try {
      const issues = aggregate(schema, reg, {
        publicKeyPem: keys.publicKeyPem,
        repoRoot,
        observationsDir: AGG_DIR,
      })
      const issue = issues.find(candidate => candidate.id === 'P0-01')!
      expect(issue.lanes.contract).toBe('REJECTED')
      expect(issue.status).toBe('REJECTED')
    } finally {
      rmSync(join(repoRoot, AGG_DIR), { recursive: true, force: true })
    }
  })

  it('reports unrun issues as NOT_RUN when no observations exist', () => {
    const issues = aggregate(schema, reg, { publicKeyPem: makeKeyPair().publicKeyPem, repoRoot, observationsDir: `${AGG_DIR}-empty` })
    expect(issues.length).toBe(100)
    expect(issues.every((issue: IssueVerdict) => issue.status === 'NOT_RUN')).toBe(true)
  })
})
