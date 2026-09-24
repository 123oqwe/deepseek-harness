/**
 * Row-ACCEPTED hardening predicates (maintainer decision BLOCKED-004/
 * BLOCKED-005, 2026-09-01).
 *
 * Covers the three pure predicates `generate-ledger.mjs --accept` gates on:
 *   - checkCoverageClosure: every registry `acceptance[]` index for an epic
 *     must have ALL of its cited command-freeze cases (primary or supplement)
 *     both frozen and CI-observed passing -- a citation that was only ever
 *     frozen (never greened) does not count, and when an index lists several
 *     citations every one of them is a necessary sub-fact (AND), never an
 *     alternative (OR) that would let one unrelated already-passing case
 *     paper over a genuinely untested sub-kind;
 *   - checkCandidateChainConsistency: distinct cell candidateSha values are
 *     acceptable only when they form one real linear git ancestry chain
 *     (checked against this repository's actual commit graph), never merely
 *     asserted;
 *   - checkObservationDistinctness: row-level B7① recheck across cells and
 *     supplements, redefined by BLOCKED-018 (2026-09-01): a shared
 *     observation digest is a conflict only when the sharing consumers'
 *     frozen commands (argv + case-titles set) are identical -- a shared
 *     digest with genuinely different frozen commands is legitimate.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'

import type { CiRunUrlCorrectionResult, CiRunUrlCorrectionVerdict } from './generate-ledger.mjs'
import {
  acceptPreflightFindings,
  applyCiRunUrlCorrection,
  cellForCorrection,
  checkCandidateChainConsistency,
  checkCiRunUrlCorrection,
  checkCoverageClosure,
  closureFailuresForAcceptedRows,
  configFrozenReportRefusal,
  coverageArtifactDrift,
  checkDelegateSignoff,
  checkFailureSetAgainstFlakeRegistry,
  execStateDigestDrift,
  findAmbiguousCaseMatches,
  findDuplicateFrozenCases,
  frozenCommand,
  p9ItemsSettled,
  parseCiRunUrl,
  PROGRAM_CI_REPO,
  reattestationOf,
  recordedExitRefusal,
  REPORT_CONFIGS,
  reportDirMatchesCandidate,
  redStepComplaints,
  checkNoOpenFindings,
  checkObservationDistinctness,
  deriveSupplementLiveness,
  rowDigest,
  usedObservationDigests,
  validateAcceptanceCoverage,
} from './generate-ledger.mjs'
import { realitySetOverlap } from './epic-reality-set.mjs'
import { candidateTreeFindings } from './verify-freeze-in-candidate-tree.mjs'
import type { CandidateTreeFreezeEntry } from './verify-freeze-in-candidate-tree.mjs'
import { readFileSync } from 'node:fs'

// checkCandidateChainConsistency's real usage always runs locally against
// the Supervisor's own full-history clone -- never inside a CI job's shallow
// (fetch-depth: 1) checkout, which lacks the historical objects
// `git merge-base --is-ancestor` needs. So these tests build their own
// throwaway, real git repository with real commits, rather than depending on
// this repository's own commit graph being fully present wherever the test
// itself happens to run.
const fixtureRoots: string[] = []
afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).trim()
}

function makeGitFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-candidate-chain-'))
  fixtureRoots.push(root)
  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'fixture@example.com'])
  git(root, ['config', 'user.name', 'Fixture'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  return root
}

function commit(root: string, message: string, fileContent: string): string {
  writeFileSync(join(root, 'file.txt'), fileContent)
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', message])
  return git(root, ['rev-parse', 'HEAD'])
}

const registry = {
  epics: [{ id: 'E1', acceptance: ['a', 'b'] }],
}

const freeze = {
  entries: [
    { epic: 'E1', stage: 'C', expectCases: ['case-a'] },
    { epic: 'E1', stage: 'F', expectCases: ['case-b-supp'], supplements: { epic: 'E1', stage: 'F' }, supplementSeq: 1 },
  ],
}

const coverage = {
  entries: [
    { epic: 'E1', acceptanceIndex: 0, coveredBy: [{ stage: 'C', title: 'case-a' }] },
    { epic: 'E1', acceptanceIndex: 1, coveredBy: [{ stage: 'F', title: 'case-b-supp', supplementSeq: 1 }] },
  ],
}

describe('checkCoverageClosure', () => {
  it('green: every index has a frozen AND CI-observed-passing citation', () => {
    const row = {
      cells: { C: { expectCasesMatched: ['case-a'] } },
      supplements: { 'F.1': { expectCasesMatched: ['case-b-supp'] } },
    }
    const result = checkCoverageClosure('E1', registry, freeze, coverage, row)
    expect(result).toEqual({ valid: true, missingIndices: [], unverifiedCitations: [] })
  })

  it('red: a citation frozen but never CI-observed passing does not count', () => {
    const row = { cells: { C: { expectCasesMatched: ['case-a'] } }, supplements: {} }
    const result = checkCoverageClosure('E1', registry, freeze, coverage, row)
    expect(result.valid).toBe(false)
    expect(result.missingIndices).toEqual([1])
  })

  it('red: an acceptance index absent from acceptance-coverage.json entirely is missing', () => {
    const row = { cells: { C: { expectCasesMatched: ['case-a'] } }, supplements: { 'F.1': { expectCasesMatched: ['case-b-supp'] } } }
    const thinCoverage = { entries: [coverage.entries[0]] }
    const result = checkCoverageClosure('E1', registry, freeze, thinCoverage, row)
    expect(result.valid).toBe(false)
    expect(result.missingIndices).toEqual([1])
  })

  it('AND semantics: an index citing two cases needs BOTH verified, not just one', () => {
    // a single always-true case must not be able to vacuously complete a
    // multi-part index.
    const singleClauseRegistry = { epics: [{ id: 'E1', acceptance: ['a'] }] }
    const twoPartCoverage = {
      entries: [
        {
          epic: 'E1',
          acceptanceIndex: 0,
          coveredBy: [{ stage: 'C', title: 'case-a' }, { stage: 'F', title: 'case-b-supp', supplementSeq: 1 }],
        },
      ],
    }
    // only case-a is observed passing; case-b-supp's supplement was never greened.
    const row = { cells: { C: { expectCasesMatched: ['case-a'] } }, supplements: {} }
    const result = checkCoverageClosure('E1', singleClauseRegistry, freeze, twoPartCoverage, row)
    expect(result.valid).toBe(false)
    expect(result.missingIndices).toEqual([0])
    expect(result.unverifiedCitations).toEqual([{ acceptanceIndex: 0, stage: 'F', title: 'case-b-supp', supplementSeq: 1 }])
  })

  it('red: a citation naming a title the frozen entry never actually lists is rejected (no free-text claim)', () => {
    const wrongTitleCoverage = {
      entries: [{ epic: 'E1', acceptanceIndex: 0, coveredBy: [{ stage: 'C', title: 'case-that-was-never-frozen' }] }],
    }
    const row = { cells: { C: { expectCasesMatched: ['case-a', 'case-that-was-never-frozen'] } }, supplements: {} }
    const result = checkCoverageClosure('E1', registry, freeze, wrongTitleCoverage, row)
    expect(result.valid).toBe(false)
  })

  it('refuses loudly a freeze entry whose supplements key is null, rather than reading it as a primary (BLOCKED-161 §2)', () => {
    // §2 deleted the null keys instead of relaxing the predicate; a predicate
    // that reads only the seq would accept the second shape silently.
    const nullKeyFreeze = { entries: [{ epic: 'E1', stage: 'C', expectCases: ['case-a'], supplements: null }, freeze.entries[1]] }
    const row = { cells: { C: { expectCasesMatched: ['case-a'] } }, supplements: { 'F.1': { expectCasesMatched: ['case-b-supp'] } } }
    expect(() => checkCoverageClosure('E1', registry, nullKeyFreeze, coverage, row)).toThrow(/E1\.C@/)
  })

  it('refuses loudly a freeze entry with a supplementSeq but no supplements key', () => {
    const missingKeyFreeze = { entries: [freeze.entries[0], { epic: 'E1', stage: 'F', expectCases: ['case-b-supp'], supplementSeq: 1 }] }
    const row = { cells: { C: { expectCasesMatched: ['case-a'] } }, supplements: { 'F.1': { expectCasesMatched: ['case-b-supp'] } } }
    expect(() => checkCoverageClosure('E1', registry, missingKeyFreeze, coverage, row)).toThrow(/E1\.F@/)
  })

  it('red: a citation without a seq is never satisfied by a supplement entry', () => {
    // A primary is decided by the seq (BLOCKED-161 §3), so it must not widen to "any entry".
    const supplementOnlyFreeze = { entries: [{ epic: 'E1', stage: 'C', expectCases: ['case-a'], supplements: { epic: 'E1', stage: 'C' }, supplementSeq: 1 }] }
    const row = { cells: { C: { expectCasesMatched: ['case-a'] } }, supplements: {} }
    const result = checkCoverageClosure('E1', { epics: [{ id: 'E1', acceptance: ['a'] }] }, supplementOnlyFreeze, { entries: [coverage.entries[0]] }, row)
    expect(result.valid).toBe(false)
  })
})

describe('checkCandidateChainConsistency', () => {
  it('a single shared candidateSha across all applicable stages is trivially valid', () => {
    const row = { cells: { C: { candidateSha: 'a'.repeat(40) }, F: { candidateSha: 'a'.repeat(40) } } }
    expect(checkCandidateChainConsistency(row, ['C', 'F'])).toEqual({ valid: true, candidateShas: ['a'.repeat(40)], divergentPairs: [] })
  })

  it('green: distinct SHAs that form a real linear git ancestry chain are valid', () => {
    const root = makeGitFixture()
    const older = commit(root, 'first', 'a')
    const newer = commit(root, 'second', 'b')
    const row = { cells: { C: { candidateSha: older }, F: { candidateSha: newer } } }
    const result = checkCandidateChainConsistency(row, ['C', 'F'], root)
    expect(result.valid).toBe(true)
    expect(result.divergentPairs).toEqual([])
  })

  it('red: two commits with no ancestry relationship (a real fork, not an evolution) are rejected', () => {
    const root = makeGitFixture()
    const base = commit(root, 'base', 'a')
    git(root, ['checkout', '-b', 'branch-a'])
    const tipA = commit(root, 'branch a tip', 'b')
    git(root, ['checkout', base])
    git(root, ['checkout', '-b', 'branch-b'])
    const tipB = commit(root, 'branch b tip', 'c')
    const row = { cells: { C: { candidateSha: tipA }, F: { candidateSha: tipB } } }
    const result = checkCandidateChainConsistency(row, ['C', 'F'], root)
    expect(result.valid).toBe(false)
    expect(result.divergentPairs).toEqual([[tipA, tipB]])
  })

  it('no applicable stage carries a candidateSha yet: vacuously valid (nothing to check)', () => {
    const row = { cells: { C: {}, F: {} } }
    expect(checkCandidateChainConsistency(row, ['C', 'F'])).toEqual({ valid: true, candidateShas: [], divergentPairs: [] })
  })
})

describe('checkObservationDistinctness', () => {
  const epicId = 'PX-99'
  const frozenC = { epic: epicId, stage: 'C', argv: ['pnpm', 'run', 'c'], expectCases: ['c case 1'] }
  const frozenF = { epic: epicId, stage: 'F', argv: ['pnpm', 'run', 'f'], expectCases: ['f case 1'] }
  const frozenFSupp = { supplements: { epic: epicId, stage: 'F' }, supplementSeq: 1, argv: ['pnpm', 'run', 'f-supp'], expectCases: ['f supp case 1'] }

  it('green: every cell and supplement observation is pairwise distinct', () => {
    const row = {
      cells: { C: { observationSha256: 'sha-c' }, F: { observationSha256: 'sha-f' } },
      supplements: { 'F.1': { observationSha256: 'sha-f-supp' } },
    }
    const freeze = { entries: [frozenC, frozenF, frozenFSupp] }
    expect(checkObservationDistinctness(row, ['C', 'F'], freeze, epicId)).toEqual({ valid: true, conflicts: [] })
  })

  it('red: a cell and a supplement sharing one observation file with IDENTICAL frozen commands is rejected (B7① row-level recheck)', () => {
    const row = {
      cells: { C: { observationSha256: 'shared-sha' }, F: { observationSha256: 'sha-f' } },
      supplements: { 'F.1': { observationSha256: 'shared-sha' } },
    }
    // The supplement's own frozen entry is deliberately given the exact same
    // argv/expectCases as C's -- the real "one proof greens many" abuse.
    const freeze = { entries: [frozenC, frozenF, { ...frozenFSupp, argv: frozenC.argv, expectCases: frozenC.expectCases }] }
    const result = checkObservationDistinctness(row, ['C', 'F'], freeze, epicId)
    expect(result.valid).toBe(false)
    expect(result.conflicts).toEqual([['C', 'F.1']])
  })

  it('green (BLOCKED-018): two stages sharing one observation digest is allowed when their frozen commands genuinely differ', () => {
    const row = {
      cells: { C: { observationSha256: 'shared-sha' }, F: { observationSha256: 'shared-sha' } },
    }
    const freeze = { entries: [frozenC, frozenF] }
    expect(checkObservationDistinctness(row, ['C', 'F'], freeze, epicId)).toEqual({ valid: true, conflicts: [] })
  })

  it('red (BLOCKED-018): two stages sharing one observation digest with IDENTICAL frozen commands is still rejected', () => {
    const row = {
      cells: { C: { observationSha256: 'shared-sha' }, F: { observationSha256: 'shared-sha' } },
    }
    const freeze = { entries: [frozenC, { ...frozenF, argv: frozenC.argv, expectCases: frozenC.expectCases }] }
    const result = checkObservationDistinctness(row, ['C', 'F'], freeze, epicId)
    expect(result.valid).toBe(false)
    expect(result.conflicts).toEqual([['C', 'F']])
  })

  it('red: a shared digest whose consumer frozen entry cannot be resolved is treated as a conflict, fail-safe', () => {
    const row = {
      cells: { C: { observationSha256: 'shared-sha' }, F: { observationSha256: 'shared-sha' } },
    }
    const freeze = { entries: [frozenC] } // frozenF deliberately absent
    const result = checkObservationDistinctness(row, ['C', 'F'], freeze, epicId)
    expect(result.valid).toBe(false)
    expect(result.conflicts).toEqual([['C', 'F']])
  })

  // Addendum 327 / BLOCKED-242. A supplement keeps its seq when re-frozen, so
  // the retired entry precedes the live one in file order, and a record whose
  // evidence moved to a replacement is marked SUPERSEDED.
  const retiredFSuppLikeC = { ...frozenFSupp, argv: frozenC.argv, expectCases: frozenC.expectCases, supersededBy: '2026-09-12T00:00:00.000Z' }

  it('green: a SUPERSEDED supplement record is not evidence, so it is not compared at all', () => {
    // Resolving it against the live freeze finds nothing (a fail-safe conflict:
    // what turned P2-04, P4-08 and P5-11 invalid under a live-only lookup), and
    // resolving it against its retired entry compares a withdrawn command.
    const row = {
      cells: { C: { observationSha256: 'shared-sha' } },
      supplements: { 'F.1': { status: 'SUPERSEDED', observationSha256: 'shared-sha' } },
    }
    const freeze = { entries: [frozenC, retiredFSuppLikeC] }
    expect(checkObservationDistinctness(row, ['C'], freeze, epicId)).toEqual({ valid: true, conflicts: [] })
  })

  it('green: a GREEN record at a re-frozen seq is judged against the live entry, not the retired one listed first', () => {
    // The retired entry repeats C's command and the live one does not, so
    // taking the first match in file order reports a conflict that is not there.
    const row = {
      cells: { C: { observationSha256: 'shared-sha' } },
      supplements: { 'F.1': { status: 'GREEN', observationSha256: 'shared-sha' } },
    }
    const freeze = { entries: [frozenC, retiredFSuppLikeC, frozenFSupp] }
    expect(checkObservationDistinctness(row, ['C'], freeze, epicId)).toEqual({ valid: true, conflicts: [] })
  })

  it('red: a GREEN record whose LIVE entry repeats a cell\'s command is still a conflict', () => {
    // The control for the two cases above: skipping and live resolution must
    // not mute the check itself.
    const row = {
      cells: { C: { observationSha256: 'shared-sha' } },
      supplements: { 'F.1': { status: 'GREEN', observationSha256: 'shared-sha' } },
    }
    const freeze = { entries: [frozenC, { ...frozenFSupp, argv: frozenC.argv, expectCases: frozenC.expectCases }] }
    expect(checkObservationDistinctness(row, ['C'], freeze, epicId)).toEqual({ valid: false, conflicts: [['C', 'F.1']] })
  })

  it('red: a GREEN record whose seq has no live entry is unresolvable, fail-safe', () => {
    const row = {
      cells: { C: { observationSha256: 'shared-sha' } },
      supplements: { 'F.1': { status: 'GREEN', observationSha256: 'shared-sha' } },
    }
    const freeze = { entries: [frozenC, { ...frozenFSupp, supersededBy: '2026-09-12T00:00:00.000Z' }] }
    expect(checkObservationDistinctness(row, ['C'], freeze, epicId).valid).toBe(false)
  })
})

describe('usedObservationDigests (addendum 327)', () => {
  const epicId = 'PX-99'
  const frozenC = { epic: epicId, stage: 'C', argv: ['pnpm', 'run', 'c'], expectCases: ['c case 1'] }
  const liveU1 = { epic: epicId, stage: 'U', supplements: { epic: epicId, stage: 'U' }, supplementSeq: 1, argv: ['pnpm', 'run', 'u1'], expectCases: ['u1 live'] }
  const retiredU1 = { ...liveU1, expectCases: ['u1 retired'], supersededBy: '2026-09-12T00:00:00.000Z' }

  it('records a GREEN supplement against its live entry and leaves a SUPERSEDED one out', () => {
    const rows = {
      [epicId]: {
        id: epicId,
        cells: { C: { observationSha256: 'shared-sha' } },
        supplements: {
          'U.1': { status: 'GREEN', observationSha256: 'shared-sha' },
          'U.2': { status: 'SUPERSEDED', observationSha256: 'shared-sha' },
        },
      },
    }
    const used = usedObservationDigests(rows, { entries: [frozenC, retiredU1, liveU1] })
    expect(used.get('shared-sha')).toEqual([
      { label: `${epicId}.C`, frozen: frozenC },
      { label: `${epicId}.U.1 (supplement)`, frozen: liveU1 },
    ])
  })
})

describe('checkDelegateSignoff (BLOCKED-036, 2026-09-02)', () => {
  const row = { cells: { C: { status: 'GREEN' } } }
  const otherRow = { cells: { C: { status: 'GREEN' }, F: { status: 'GREEN' } } }
  const digest = rowDigest(row)

  it('red: no sign-off registry at all', () => {
    const result = checkDelegateSignoff('E1', row, { entries: [] }, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing')
    expect(result.currentRowDigest).toBe(digest)
  })

  it('red: a sign-off exists for a different epic', () => {
    const registry = { entries: [{ epic: 'E2', rowDigestSha256: digest, conclusion: 'PASS' }] }
    const result = checkDelegateSignoff('E1', row, registry, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing')
  })

  it('red (stale): a sign-off exists for this epic but the row has changed since (digest mismatch)', () => {
    const registry = { entries: [{ epic: 'E1', rowDigestSha256: rowDigest(otherRow), conclusion: 'PASS' }] }
    const result = checkDelegateSignoff('E1', row, registry, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('stale')
  })

  it('red: a FAIL-conclusion entry does not count even at a matching digest', () => {
    const registry = { entries: [{ epic: 'E1', rowDigestSha256: digest, conclusion: 'FAIL' }] }
    const result = checkDelegateSignoff('E1', row, registry, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing')
  })

  it('green: a PASS sign-off at the current row digest, epic not in the user-confirmation tier', () => {
    const registry = { entries: [{ epic: 'E1', rowDigestSha256: digest, conclusion: 'PASS', delegateSession: 'guanjieqiao-92' }] }
    const result = checkDelegateSignoff('E1', row, registry, new Set())
    expect(result.valid).toBe(true)
    expect(result.matchedEntry?.delegateSession).toBe('guanjieqiao-92')
  })

  it('red: a user-confirmation-tier epic with a PASS sign-off but no userConfirmationRef', () => {
    const registry = { entries: [{ epic: 'P2-01', rowDigestSha256: rowDigest(row), conclusion: 'PASS' }] }
    const result = checkDelegateSignoff('P2-01', row, registry, new Set(['P2-01']))
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing-user-confirmation-ref')
  })

  it('green: a user-confirmation-tier epic with a PASS sign-off AND a userConfirmationRef', () => {
    const registry = {
      entries: [{ epic: 'P2-01', rowDigestSha256: rowDigest(row), conclusion: 'PASS', userConfirmationRef: 'decisions-approved.md#C8' }],
    }
    const result = checkDelegateSignoff('P2-01', row, registry, new Set(['P2-01']))
    expect(result.valid).toBe(true)
    expect(result.matchedEntry?.userConfirmationRef).toBe('decisions-approved.md#C8')
  })

  it('rowDigest: identical row content produces the identical digest regardless of object identity', () => {
    expect(rowDigest({ cells: { C: { status: 'GREEN' } } })).toBe(digest)
  })

  it('rowDigest: a genuinely different row produces a different digest', () => {
    expect(rowDigest(otherRow)).not.toBe(digest)
  })

  it('default userConfirmationTierEpics (no 4th arg): a non-tier epic with a valid PASS sign-off is green', () => {
    const registry = { entries: [{ epic: 'E1', rowDigestSha256: digest, conclusion: 'PASS' }] }
    expect(checkDelegateSignoff('E1', row, registry).valid).toBe(true)
  })

  it('default userConfirmationTierEpics (no 4th arg): the real user-confirmation-tier epic P2-01 requires a ref', () => {
    const registry = { entries: [{ epic: 'P2-01', rowDigestSha256: digest, conclusion: 'PASS' }] }
    const result = checkDelegateSignoff('P2-01', row, registry)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing-user-confirmation-ref')
  })
})

describe('checkFailureSetAgainstFlakeRegistry (BLOCKED-007 item 3, 2026-09-01)', () => {
  const registry = {
    entries: [{ testFullName: 'suite known flake test' }, { testFullName: 'other suite another flake' }],
  }

  it('no failures at all: not an absorption case (the ordinary exit===expectExit path handles this, never reaches this check)', () => {
    const result = checkFailureSetAgainstFlakeRegistry(new Set(), registry)
    expect(result.valid).toBe(false)
    expect(result.unregisteredFailures).toEqual([])
    expect(result.absorbedFlakes).toEqual([])
  })

  it('every failure is a registered flake: absorbed', () => {
    const result = checkFailureSetAgainstFlakeRegistry(new Set(['suite known flake test']), registry)
    expect(result.valid).toBe(true)
    expect(result.absorbedFlakes).toEqual(['suite known flake test'])
    expect(result.unregisteredFailures).toEqual([])
  })

  it('multiple failures, all registered: absorbed', () => {
    const result = checkFailureSetAgainstFlakeRegistry(new Set(['suite known flake test', 'other suite another flake']), registry)
    expect(result.valid).toBe(true)
    expect(result.absorbedFlakes.sort()).toEqual(['other suite another flake', 'suite known flake test'])
  })

  it('fail-closed: one failure genuinely unrelated to the registry is rejected, even alongside a registered one', () => {
    const result = checkFailureSetAgainstFlakeRegistry(new Set(['suite known flake test', 'a real regression this slice caused']), registry)
    expect(result.valid).toBe(false)
    expect(result.unregisteredFailures).toEqual(['a real regression this slice caused'])
  })

  it('fail-closed: no registry file present (null) rejects every failure', () => {
    const result = checkFailureSetAgainstFlakeRegistry(new Set(['suite known flake test']), null)
    expect(result.valid).toBe(false)
    expect(result.unregisteredFailures).toEqual(['suite known flake test'])
  })

  it('fail-closed: an empty registry (no entries yet) rejects every failure', () => {
    const result = checkFailureSetAgainstFlakeRegistry(new Set(['suite known flake test']), { entries: [] })
    expect(result.valid).toBe(false)
  })

  it('never exempts the test itself -- absorption only changes greening eligibility, the failure still shows up in absorbedFlakes', () => {
    const result = checkFailureSetAgainstFlakeRegistry(new Set(['suite known flake test']), registry)
    expect(result.absorbedFlakes).toContain('suite known flake test')
  })
})

describe('findAmbiguousCaseMatches (BLOCKED-104, 2026-09-06)', () => {
  it('accepts a frozen string that names exactly one passing case', () => {
    const counts = new Map([['P5-11 Fault — matrix enumerates twelve boundaries', 1]])
    expect(findAmbiguousCaseMatches(['P5-11 Fault — matrix enumerates twelve boundaries'], counts)).toStrictEqual([])
  })

  it('rejects a bare title six epics share, which any one of them would satisfy', () => {
    const counts = new Map([['enumerates twelve boundaries', 6]])
    expect(findAmbiguousCaseMatches(['enumerates twelve boundaries'], counts)).toStrictEqual([
      { title: 'enumerates twelve boundaries', count: 6 },
    ])
  })

  it('rejects a conformance title the fake provider alone would satisfy', () => {
    const counts = new Map([['get() resolves the record previously created by propose()', 2]])
    expect(findAmbiguousCaseMatches(['get() resolves the record previously created by propose()'], counts)).toStrictEqual([
      { title: 'get() resolves the record previously created by propose()', count: 2 },
    ])
  })

  it('reports only the ambiguous strings, leaving unique siblings out of the diagnostic', () => {
    const counts = new Map([['shared', 3], ['unique', 1]])
    expect(findAmbiguousCaseMatches(['unique', 'shared'], counts)).toStrictEqual([{ title: 'shared', count: 3 }])
  })

  it('does not report a string that matches nothing: a missing case is the earlier check\'s failure, not this one\'s', () => {
    expect(findAmbiguousCaseMatches(['absent'], new Map())).toStrictEqual([])
  })
})

describe('findDuplicateFrozenCases (BLOCKED-104, 2026-09-06)', () => {
  it('accepts an entry whose case strings are all distinct', () => {
    expect(findDuplicateFrozenCases(['a', 'b', 'c'])).toStrictEqual([])
  })

  it("rejects P6-01's shape: six titles written twice to mean two provider runs", () => {
    const six = ['propose()', 'query()', 'get()', 'revise()', 'forget()', 'export()']
    expect(findDuplicateFrozenCases([...six, ...six])).toStrictEqual(six.map(title => ({ title, count: 2 })))
  })

  it('accepts the fullName form the rejection forces, where two runs cannot collide', () => {
    expect(findDuplicateFrozenCases([
      'conformance: local reference provider get() resolves the record',
      'conformance: fake provider get() resolves the record',
    ])).toStrictEqual([])
  })

  it('reports how many times each repeat appears, so a triple is not read as a pair', () => {
    expect(findDuplicateFrozenCases(['x', 'x', 'x', 'y'])).toStrictEqual([{ title: 'x', count: 3 }])
  })
})

describe('checkDelegateSignoff — withdrawal (delegate ruling, 2026-09-07)', () => {
  const row = { cells: {}, status: 'ACCEPTED' }
  const digest = 'ignored-by-these-cases'

  it('a PASS matching the current row digest is valid', () => {
    const registry = { entries: [{ epic: 'P4-07', rowDigestSha256: rowDigest(row), conclusion: 'PASS' }] }
    expect(checkDelegateSignoff('P4-07', row, registry).valid).toBe(true)
  })

  it('a WITHDRAWN recorded AFTER a PASS invalidates it, without deleting the PASS', () => {
    const registry = {
      entries: [
        { epic: 'P4-07', rowDigestSha256: rowDigest(row), conclusion: 'PASS' },
        { epic: 'P4-07', rowDigestSha256: rowDigest(row), conclusion: 'WITHDRAWN', reason: 'must[3] has no subject' },
      ],
    }
    const result = checkDelegateSignoff('P4-07', row, registry)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('withdrawn')
    // The retracted PASS is still in the file: append-only means the history is
    // readable, and the verdict comes from the order rather than from deletion.
    expect(registry.entries.filter(e => e.conclusion === 'PASS')).toHaveLength(1)
  })

  it('a later PASS re-signs a withdrawn epic, so withdrawal is not permanent', () => {
    const registry = {
      entries: [
        { epic: 'P4-07', rowDigestSha256: rowDigest(row), conclusion: 'PASS' },
        { epic: 'P4-07', rowDigestSha256: rowDigest(row), conclusion: 'WITHDRAWN', reason: 'gap found' },
        { epic: 'P4-07', rowDigestSha256: rowDigest(row), conclusion: 'PASS' },
      ],
    }
    expect(checkDelegateSignoff('P4-07', row, registry).valid).toBe(true)
  })

  it("another epic's withdrawal does not touch this one", () => {
    const registry = {
      entries: [
        { epic: 'P4-07', rowDigestSha256: rowDigest(row), conclusion: 'PASS' },
        { epic: 'P8-01', rowDigestSha256: rowDigest(row), conclusion: 'WITHDRAWN', reason: 'unrelated' },
      ],
    }
    expect(checkDelegateSignoff('P4-07', row, registry).valid).toBe(true)
  })

  it('the withdrawal reason is carried back, since it is the part a digest cannot reconstruct', () => {
    const registry = {
      entries: [{ epic: 'P4-07', rowDigestSha256: digest, conclusion: 'WITHDRAWN', reason: 'must[3] has no subject' }],
    }
    expect(checkDelegateSignoff('P4-07', row, registry).matchedEntry?.reason).toBe('must[3] has no subject')
  })
})

describe('the program gate counts a P9 item the goal admits', () => {
  it('a scheduled-BLOCKED item is settled, because the goal says VERIFIED **or** blocked', () => {
    // P9-05 is the first item ever in this state. Requiring VERIFIED alone
    // would hold the whole program at NO-GO over an item whose every stage had
    // settled — some proved, the rest parked on a recorded, still-open blocker.
    expect(p9ItemsSettled([
      { terminalState: 'VERIFIED' },
      { terminalState: 'VERIFIED_OR_BLOCKED' },
    ])).toBe(true)
  })

  it('an unfinished item is not settled', () => {
    // The control: without it, a predicate returning true for anything would
    // satisfy the case above.
    for (const terminalState of ['IN_PROGRESS', 'PREMATURE', 'STALE_BLOCKER']) {
      expect(p9ItemsSettled([{ terminalState: 'VERIFIED' }, { terminalState }]), terminalState).toBe(false)
    }
  })

  it('an EMPTY record is not settled — nothing observed is not everything settled', () => {
    // A gate reading an absent record as success would pass hardest when it
    // knew least.
    expect(p9ItemsSettled([])).toBe(false)
  })
})

describe('reattestationOf (BLOCKED-137, 2026-09-07)', () => {
  const prior = { ciRunUrl: 'https://ci/runs/1', candidateSha: 'a'.repeat(40) }

  it('records what the re-green replaced, so a red-run admission is not deleted by its own repair', () => {
    expect(reattestationOf(prior, 'https://ci/runs/2', 'replaced by a green observation', '2026-09-07T00:00:00.000Z'))
      .toEqual({
        fromCiRunUrl: 'https://ci/runs/1',
        fromCandidateSha: 'a'.repeat(40),
        reason: 'replaced by a green observation',
        atUtc: '2026-09-07T00:00:00.000Z',
      })
  })

  it('records nothing when the run is UNCHANGED, so a reason cannot claim a replacement that did not happen', () => {
    // Without this, re-running the same greening command twice would stamp the
    // cell as re-attested away from the run it is still on.
    expect(reattestationOf(prior, 'https://ci/runs/1', 'replaced by a green observation', '2026-09-07T00:00:00.000Z'))
      .toBeUndefined()
  })

  it('records nothing for a cell that was never green, which replaced no observation', () => {
    expect(reattestationOf(undefined, 'https://ci/runs/2', 'a reason', '2026-09-07T00:00:00.000Z')).toBeUndefined()
    expect(reattestationOf({}, 'https://ci/runs/2', 'a reason', '2026-09-07T00:00:00.000Z')).toBeUndefined()
  })

  it('records nothing without a stated reason, so the field never appears unexplained', () => {
    expect(reattestationOf(prior, 'https://ci/runs/2', undefined, '2026-09-07T00:00:00.000Z')).toBeUndefined()
  })
})

describe('redStepComplaints (BLOCKED-137 §12.6, 2026-09-07)', () => {
  const good = {
    step: 'install / typecheck / test @ exact SHA — the snapshot job',
    failingCases: ['replays pwsh-tool-turn through dsh --profile headless'],
    evidence: 'AssertionError: ... "sequence":0 ... "sequence":1',
    subjectPaths: ['snapshots/session/pwsh-tool-turn'],
  }

  it('admits a step carrying all four fields', () => {
    expect(redStepComplaints([good])).toEqual([])
  })

  it('refuses a step whose evidence is missing, which is how a name-matched waiver looked correct', () => {
    // BLOCKED-108's waivers all carried a reason. What they lacked was text
    // from the failure in front of them, so nobody could check the diagnosis
    // against the run.
    expect(redStepComplaints([{ ...good, evidence: '   ' }])).toHaveLength(1)
    expect(redStepComplaints([{ ...good, evidence: undefined }])[0]).toMatch(/verbatim/u)
  })

  it('refuses a step with no subjectPaths, without which unrelatedness cannot be computed at all', () => {
    expect(redStepComplaints([{ ...good, subjectPaths: [] }])[0]).toMatch(/unrelatedness cannot be computed/u)
  })

  it('refuses an EMPTY admission, so "no red steps" cannot pass as "no problem"', () => {
    expect(redStepComplaints([])).toHaveLength(1)
    expect(redStepComplaints(undefined)).toHaveLength(1)
  })

  it('names every defective step, not just the first, so one fix per run is not required', () => {
    expect(redStepComplaints([{ ...good, evidence: '' }, { ...good, failingCases: [] }])).toHaveLength(2)
  })
})

describe('realitySetOverlap (BLOCKED-134/137)', () => {
  const epicPaths = ['packages/core/agent/src/dispatch.ts', 'packages/run/lease/src/index.ts']

  it('is empty for a failure the epic never touched, which is what licenses an admission', () => {
    expect(realitySetOverlap(epicPaths, ['snapshots/session/pwsh-tool-turn'])).toEqual([])
  })

  it('names the overlap for a file the epic owns, so "unrelated" cannot be claimed over its own code', () => {
    // The positive control. Without it, a matcher that never matches would
    // license every admission — BLOCKED-137's shape exactly.
    expect(realitySetOverlap(epicPaths, ['packages/core/agent/src/dispatch.ts']))
      .toEqual([{ subject: 'packages/core/agent/src/dispatch.ts', declared: 'packages/core/agent/src/dispatch.ts' }])
  })

  it('matches a declared file underneath a subject DIRECTORY, not only an exact path', () => {
    expect(realitySetOverlap(epicPaths, ['packages/run/lease'])).toHaveLength(1)
  })
})

describe('deriveSupplementLiveness (§12.61: the freeze is the authority on which supplements are live)', () => {
  /** One ledger supplement, widened so a case can read the stamp the derivation adds. */
  type SupplementRow = { status: string; supersededBy?: string }
  /** Ledger rows in the shape the derivation mutates. */
  type Rows = Record<string, { id: string; supplements: Record<string, SupplementRow> }>

  const superseded = [
    { epic: 'P4-06', stage: 'P', supplementSeq: 1, supersededBy: 'P4-06.P.3 (BLOCKED-138 key-format correction)' },
    { epic: 'P4-06', stage: 'P', supplementSeq: 3 },
  ]

  it('marks a GREEN supplement SUPERSEDED when its frozen entry was retired, and records what retired it', () => {
    // The defect: P4-06.P.1 sat GREEN@b3186e6db9 after freeze #173 was
    // superseded by P.3, so the ledger asserted a live green for an entry the
    // freeze had already retired — two files disagreeing, with the stale one
    // reading as the stronger claim.
    const rows: Rows = {
      'P4-06': { id: 'P4-06', supplements: { 'P.1': { status: 'GREEN' }, 'P.3': { status: 'GREEN' } } },
    }
    deriveSupplementLiveness(rows, superseded)

    expect(rows['P4-06']?.supplements['P.1']?.status).toBe('SUPERSEDED')
    expect(rows['P4-06']?.supplements['P.1']?.supersededBy).toContain('P4-06.P.3')
    // The live sibling is untouched, so this is a derivation and not a sweep.
    expect(rows['P4-06']?.supplements['P.3']?.status).toBe('GREEN')
    expect('supersededBy' in (rows['P4-06']?.supplements['P.3'] ?? {})).toBe(false)
  })

  it('leaves a supplement alone when NO frozen entry matches, rather than guessing it is dead', () => {
    // Absence of a freeze entry is a different fact from a retired one, and
    // treating them alike would silently retire a supplement whose freeze
    // simply has not been written yet.
    const rows: Rows = { 'P4-06': { id: 'P4-06', supplements: { 'U.9': { status: 'GREEN' } } } }
    deriveSupplementLiveness(rows, superseded)
    expect(rows['P4-06']?.supplements['U.9']?.status).toBe('GREEN')
  })

  it('does not resurrect a non-GREEN supplement into SUPERSEDED, so a RED entry keeps saying RED', () => {
    const rows: Rows = { 'P4-06': { id: 'P4-06', supplements: { 'P.1': { status: 'RED' } } } }
    deriveSupplementLiveness(rows, superseded)
    // The retirement is still recorded, but the observation's own verdict stands.
    expect(rows['P4-06']?.supplements['P.1']?.status).toBe('RED')
    expect(rows['P4-06']?.supplements['P.1']?.supersededBy).toContain('P4-06.P.3')
  })
})

describe('checkNoOpenFindings (§12.63: accept and green-cell judge open findings alike)', () => {
  it('REFUSES an epic carrying an open finding, and returns the findings so the caller can name them', () => {
    // The defect: greening a cell refused an epic with an open finding while
    // accepting the epic outright did not, so P4-09 reached "only (iv)
    // remains" while carrying BLOCKED-100's "must[2] (detached) has no
    // implementation". Signing that would have signed a clause with no subject.
    const row = { openFindings: ['BLOCKED-100: must[2] (detached) has no implementation'] }
    const result = checkNoOpenFindings(row)
    expect(result.valid).toBe(false)
    expect(result.open).toEqual(['BLOCKED-100: must[2] (detached) has no implementation'])
  })

  it('ADMITS an epic with no findings, whether the field is absent, null or empty', () => {
    // The positive control, and the three spellings the ledger actually holds:
    // `--close-finding` sets the field to null once the last one closes, and a
    // row that never had one omits it entirely. A predicate that only
    // understood `[]` would refuse both of those.
    expect(checkNoOpenFindings({}).valid).toBe(true)
    expect(checkNoOpenFindings({ openFindings: null }).valid).toBe(true)
    expect(checkNoOpenFindings({ openFindings: [] }).valid).toBe(true)
  })
})

describe('acceptPreflightFindings (108: --accept reads the epic-state gates for the epic being accepted)', () => {
  const control = 'packages/action/action-manifest/tests/manifest.spec.ts'
  const clean = () => ({
    makeVsUse: { findings: [] as { epic: string; text: string }[], control: control as string | undefined },
    candidateTree: { missing: [] as { epic: string; text: string }[], unreadable: [] as { epic: string; text: string }[] },
    adaptDispositions: { unrecorded: [] as { id: string; missing: string[] }[] },
    missingFreezeFiles: [] as { label: string; path: string }[],
    additionsMissing: [] as { where: string; path: string; expectedAt: string | undefined }[],
  })

  it('finds nothing when every gate is clean, so the pre-flight is a check and not a blanket block', () => {
    expect(acceptPreflightFindings('P9-99', clean())).toStrictEqual([])
  })

  it('refuses on a make-vs-use finding of this epic, naming the gate and quoting the finding', () => {
    const results = clean()
    results.makeVsUse.findings.push({ epic: 'P9-99', text: 'P9-99: owns RFC 8785 JCS by assignment with no frozen case naming it' })
    expect(acceptPreflightFindings('P9-99', results)).toStrictEqual([{ gate: 'first100:verify-make-vs-use', text: 'P9-99: owns RFC 8785 JCS by assignment with no frozen case naming it' }])
  })

  it('refuses on a missing or unreadable candidate-tree record of this epic', () => {
    const results = clean()
    results.candidateTree.missing.push({ epic: 'P9-99', text: 'P9-99.C: 1 live freeze entry/entries absent from 0123456789' })
    results.candidateTree.unreadable.push({ epic: 'P9-99', text: 'P9-99.U.1: candidate abc is not readable in this clone' })
    expect(acceptPreflightFindings('P9-99', results).map(f => f.gate)).toStrictEqual(['first100:verify-freeze-in-candidate-tree', 'first100:verify-freeze-in-candidate-tree'])
  })

  it('refuses on an undisclosed adapt disposition of this epic, one finding per missing line', () => {
    const results = clean()
    results.adaptDispositions.unrecorded.push({ id: 'P9-99', missing: ['adapt canonicalize appears in neither adopted[] nor deviations[]', 'no makeVsUse record at all'] })
    expect(acceptPreflightFindings('P9-99', results)).toStrictEqual([
      { gate: 'first100:verify-adapt-dispositions', text: 'P9-99: adapt canonicalize appears in neither adopted[] nor deviations[]' },
      { gate: 'first100:verify-adapt-dispositions', text: 'P9-99: no makeVsUse record at all' },
    ])
  })

  it('refuses on a live freeze file of this epic that does not exist, a supplement included', () => {
    const results = clean()
    results.missingFreezeFiles.push({ label: 'P9-99.U.2', path: 'packages/demo/thing/src/gone.ts' })
    expect(acceptPreflightFindings('P9-99', results)).toStrictEqual([{ gate: 'first100:verify-declared-files-exist', text: 'P9-99.U.2 packages/demo/thing/src/gone.ts does not exist' }])
  })

  it('does not refuse on any gate\'s finding that belongs to another epic', () => {
    const results = clean()
    results.makeVsUse.findings.push({ epic: 'P9-98', text: 'P9-98: the ledger REJECTS left-pad, but x.ts imports it' })
    results.candidateTree.missing.push({ epic: 'P9-98', text: 'P9-98.C: 1 live freeze entry/entries absent from 0123456789' })
    results.adaptDispositions.unrecorded.push({ id: 'P9-98', missing: ['no makeVsUse record at all'] })
    results.missingFreezeFiles.push({ label: 'P9-98.U', path: 'packages/demo/thing/src/gone.ts' })
    expect(acceptPreflightFindings('P9-99', results)).toStrictEqual([])
  })

  it('refuses on an approved addition this stage was to create and did not', () => {
    const results = clean()
    results.additionsMissing.push({ where: 'P9-99.P', path: 'packages/demo/thing/tests/policy.spec.ts', expectedAt: 'stage' })
    expect(acceptPreflightFindings('P9-99', results)).toStrictEqual([{
      gate: 'first100:verify-declared-files-exist',
      text: 'P9-99.P has an approved addition for packages/demo/thing/tests/policy.spec.ts, which this stage creates and did not',
    }])
  })

  it('does not refuse on a tree addition, whose absence says something about the tree and is printed instead', () => {
    const results = clean()
    results.additionsMissing.push({ where: 'P9-99.U', path: 'packages/demo/thing/src/gone.ts', expectedAt: 'tree' })
    expect(acceptPreflightFindings('P9-99', results)).toStrictEqual([])
  })

  it('does not refuse on another epic\'s stage addition', () => {
    const results = clean()
    results.additionsMissing.push({ where: 'P9-98.P', path: 'packages/demo/thing/tests/policy.spec.ts', expectedAt: 'stage' })
    expect(acceptPreflightFindings('P9-99', results)).toStrictEqual([])
  })

  it('refuses every epic when the make-vs-use import scan found nothing', () => {
    const results = clean()
    results.makeVsUse.control = undefined
    expect(acceptPreflightFindings('P9-99', results).map(f => f.gate)).toStrictEqual(['first100:verify-make-vs-use'])
  })
})

describe('validateAcceptanceCoverage (BLOCKED-206: the schema is executed, not just declared)', () => {
  const schema: unknown = JSON.parse(
    readFileSync(new URL('../../spec/first100/exec/acceptance-coverage.schema.json', import.meta.url), 'utf8'),
  )

  it('REFUSES an entry carrying a field the schema never declared', () => {
    // The real defect, in miniature. Two P4-09 entries carried `status` for
    // six days under `additionalProperties: false`, and one of them --
    // `NOT COVERED` on acceptance[1] -- contradicted its own note, which had
    // been corrected to `COVERED since U.2`. The field no reader consulted
    // stayed behind because nothing executed the schema.
    const drifted = {
      schema: { name: 'first100-acceptance-coverage', version: '1.0' },
      entries: [
        {
          epic: 'P4-09',
          acceptanceIndex: 1,
          coveredBy: [{ stage: 'U', title: 'a parent cancel reaches its nested run' }],
          status: 'NOT COVERED',
        },
      ],
    }
    const result = validateAcceptanceCoverage(schema, drifted)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.params['additionalProperty'] === 'status')).toBe(true)
  })

  it('ADMITS the real acceptance-coverage.json, so the gate is not vacuously red', () => {
    // The positive control the refusal above is worthless without: a predicate
    // that rejected everything would also reject the drifted document.
    const coverage: unknown = JSON.parse(
      readFileSync(new URL('../../spec/first100/exec/acceptance-coverage.json', import.meta.url), 'utf8'),
    )
    expect(validateAcceptanceCoverage(schema, coverage)).toEqual({ valid: true, errors: [] })
  })

  it('REFUSES a citation naming a stage outside the closed C/P/U/F set', () => {
    // The other half of what the schema promises and nothing checked: the
    // stage enum. A citation naming 'X' would have been read by
    // checkCoverageClosure as a stage no freeze entry can match, failing the
    // index for a reason that names the symptom rather than the typo.
    const badStage = {
      schema: { name: 'first100-acceptance-coverage', version: '1.0' },
      entries: [{ epic: 'P4-01', acceptanceIndex: 0, coveredBy: [{ stage: 'X', title: 'whatever' }] }],
    }
    expect(validateAcceptanceCoverage(schema, badStage).valid).toBe(false)
  })
})

describe('reportDirMatchesCandidate (P4-06.P.3, 2026-09-15)', () => {
  function chain(): { root: string; base: string; head: string; other: string } {
    const root = makeGitFixture()
    // A token of all digits is refused as a run id by design, and about one
    // commit in 110 has ten digits first, which failed the prefix case at random.
    // Commit again until the first ten characters carry a letter.
    let base = commit(root, 'base', 'a')
    for (let attempt = 1; !/[a-f]/u.test(base.slice(0, 10)); attempt += 1) {
      if (attempt > 50) throw new Error(`no base commit with a letter in its first 10 characters after ${String(attempt)} attempts`)
      base = commit(root, 'base', `a${String(attempt)}`)
    }
    const head = commit(root, 'head', 'b')
    git(root, ['checkout', '-b', 'side', base])
    const other = commit(root, 'side', 'c')
    return { root, base, head, other }
  }

  it('accepts an upload directory named after the candidate itself', () => {
    const { root, base } = chain()
    expect(reportDirMatchesCandidate(`/store/1/first100-vitest-report-${base}/vitest-report.json`, base, root)).toStrictEqual({ ok: true })
  })

  it('accepts a directory carrying a 10-character prefix of the candidate', () => {
    const { root, base } = chain()
    expect(reportDirMatchesCandidate(`/scratch/obs-${base.slice(0, 10)}/vitest-report.json`, base, root)).toStrictEqual({ ok: true })
  })

  it('accepts a candidate observed through a later push whose head names the directory', () => {
    const { root, base, head } = chain()
    expect(reportDirMatchesCandidate(`/tmp/first100-evidence-${head}/vitest-report.json`, base, root)).toStrictEqual({ ok: true })
  })

  it('refuses the frozen-command shape that stood in for a report, which carries no token', () => {
    const { root, base } = chain()
    expect(reportDirMatchesCandidate('/scratch/frozen-cmds/p4-06-p1.json', base, root).ok).toBe(false)
  })

  it('refuses an all-digit run id, which is a hex string but not a commit', () => {
    const { root, base } = chain()
    expect(reportDirMatchesCandidate('/store/34692381416/vitest-report.json', base, root).ok).toBe(false)
  })

  it('refuses a token that names no commit in the repository', () => {
    const { root, base } = chain()
    const verdict = reportDirMatchesCandidate('/scratch/obs-deadbeefcafe/vitest-report.json', base, root)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('names no commit')
  })

  it('refuses a directory whose first token names no commit, even when a later token is a descendant head', () => {
    const { root, base, head } = chain()
    const verdict = reportDirMatchesCandidate(`/tmp/first100-evidence-deadbeefcafe-${head}/vitest-report.json`, base, root)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('deadbeefcafe names no commit')
  })

  it('refuses a token naming a commit the candidate is not an ancestor of', () => {
    const { root, head, other } = chain()
    expect(reportDirMatchesCandidate(`/tmp/first100-evidence-${other}/vitest-report.json`, head, root).ok).toBe(false)
  })
})

describe('EXEC-STATE digest drift: a hand edit to command-freeze.json fails --check', () => {
  const bytes = { ledger: 'ledger bytes', registry: 'registry bytes', freeze: 'freeze bytes' }
  const digest = (text: string): string => createHash('sha256').update(text).digest('hex')
  const synced = { ledgerDigest: digest(bytes.ledger), registryDigest: digest(bytes.registry), freezeDigest: digest(bytes.freeze) }

  it('reports nothing when every recorded digest matches its file', () => {
    expect(execStateDigestDrift(synced, bytes)).toStrictEqual([])
  })

  it('reports freezeDigest when command-freeze.json changed after the last sync', () => {
    const edited = { ...bytes, freeze: 'freeze bytes, edited by hand' }
    expect(execStateDigestDrift(synced, edited)).toStrictEqual([{ field: 'freezeDigest', recorded: synced.freezeDigest, actual: digest(edited.freeze) }])
  })

  it('reports an absent freezeDigest instead of skipping it', () => {
    const { freezeDigest: _freezeDigest, ...withoutFreeze } = synced
    expect(execStateDigestDrift(withoutFreeze, bytes)).toStrictEqual([{ field: 'freezeDigest', recorded: undefined, actual: digest(bytes.freeze) }])
  })

  it('reports an absent ledgerDigest or registryDigest the same way', () => {
    expect(execStateDigestDrift({ freezeDigest: synced.freezeDigest }, bytes)).toStrictEqual([
      { field: 'ledgerDigest', recorded: undefined, actual: digest(bytes.ledger) },
      { field: 'registryDigest', recorded: undefined, actual: digest(bytes.registry) },
    ])
  })
})

describe('--correct-ci-run-url: a recorded run URL is a string that can be typed wrong', () => {
  const RUN = '34652643903'
  const right = `https://github.com/${PROGRAM_CI_REPO}/actions/runs/${RUN}`
  const wrong = `https://github.com/deepseek-ai/deepseek-harness/actions/runs/${RUN}`

  /**
   * Narrow a result to its refusal arm, failing the case when it admitted.
   *
   * An `asserts` signature and not a bare `expect`: `expect(v.ok).toBe(false)`
   * is a runtime check that TypeScript cannot see, so reading `v.reason` after
   * it is an access on the union, not on the refusal. That was a type error in
   * six places here before this helper existed, and the in-process probe that
   * exercised the same six assertions could not have caught it -- the probe is
   * `.mjs` and never meets `tsc`.
   *
   * Both unions share this arm exactly, so one helper narrows either.
   *
   * The `reportDirMatchesCandidate` cases above read `verdict.reason` straight
   * after the same `expect` and compile, which is not an inconsistency to copy:
   * `ReportDirVerdict` is `{ ok: boolean; reason?: string }`, one shape rather
   * than two, so `reason` is always present in the type and `undefined` in the
   * admitting case. These two results are discriminated unions instead, which
   * is the stronger declaration -- a caller cannot read a reason that a
   * successful outcome does not carry.
   * @param value - the verdict or result to narrow.
   */
  function assertRefused(value: CiRunUrlCorrectionVerdict | CiRunUrlCorrectionResult): asserts value is { ok: false; reason: string } {
    expect(value.ok, `expected a refusal, got ${JSON.stringify(value)}`).toBe(false)
  }

  /**
   * Narrow a result to its applied arm.
   * @param value - the result to narrow.
   */
  function assertApplied(value: CiRunUrlCorrectionResult): asserts value is { ok: true; rewritten: string[]; from: string } {
    expect(value.ok, `expected the correction to apply, got ${JSON.stringify(value)}`).toBe(true)
  }

  /** One cell as this command reads and rewrites it. */
  interface CorrectableCell {
    status: string
    ciRunUrl?: string
    candidateSha?: string
    outcome?: string
    reattested?: unknown
    ciRunUrlCorrections?: { from: string; to: string; reason: string; correctedAtUtc: string }[]
  }

  /** One ledger row, with the accepted-evidence copy that shadows a base cell. */
  interface CorrectableRow {
    cells: Record<string, CorrectableCell>
    /** Keyed `<stage>.<seq>`, the way the ledger stores a supplement. */
    supplements: Record<string, CorrectableCell>
    acceptedEvidence?: { cells: Record<string, { ciRunUrl?: string; candidateSha?: string }> }
  }

  /**
   * A ledger row carrying one base cell and one supplement, both at `wrong`.
   * @param accepted - whether the row also carries the accepted-evidence copy.
   * @returns the row, fresh per case so no case sees another's mutation.
   */
  function row(accepted: boolean): CorrectableRow {
    return {
      cells: { U: { status: 'GREEN', ciRunUrl: wrong, candidateSha: 'abc', outcome: 'passed' } },
      // The REAL key shape the ledger uses: flat `U.1`, not nested `U[1]`.
      // The first version of this fixture used the nested form, which is what
      // let a supplement lookup written to the same wrong shape pass all eight
      // cases and then refuse every real row with `no supplement 1 at stage U`.
      supplements: { 'U.1': { status: 'GREEN', ciRunUrl: wrong, candidateSha: 'abc' } },
      ...accepted ? { acceptedEvidence: { cells: { U: { ciRunUrl: wrong, candidateSha: 'abc' } } } } : {},
    }
  }

  it('REFUSES a correction that moves the run, because that is a different observation', () => {
    const verdict = checkCiRunUrlCorrection(wrong, `https://github.com/${PROGRAM_CI_REPO}/actions/runs/99999999999`)
    assertRefused(verdict)
    // The message names both ids: an operator who mistyped one digit needs to
    // see which run the cell actually holds, not only that it was refused.
    expect(verdict.reason).toContain(RUN)
    expect(verdict.reason).toContain('99999999999')
  })

  it('REFUSES a target outside this program\'s repository, which is the defect that produced it', () => {
    const verdict = checkCiRunUrlCorrection(right, wrong)
    assertRefused(verdict)
    expect(verdict.reason).toContain('deepseek-ai/deepseek-harness')
  })

  it('REFUSES a target carrying anything after the run id, which is a different page', () => {
    expect(parseCiRunUrl(`${right}/job/12345`)).toBeUndefined()
    expect(parseCiRunUrl(`${right}?check_suite_focus=true`)).toBeUndefined()
    expect(checkCiRunUrlCorrection(wrong, `${right}/job/12345`).ok).toBe(false)
  })

  it('REFUSES a cell that carries no url at all, rather than inventing provenance', () => {
    const outcome = applyCiRunUrlCorrection({ cells: { U: { status: 'NOT_RUN' } } }, {
      stage: 'U', supplementSeq: undefined, to: right, reason: 'r', atUtc: 'now',
    })
    assertRefused(outcome)
    expect(outcome.reason).toContain('nothing to correct')
  })

  it('rewrites the cell AND the accepted-evidence copy in one act, because the copy has no back-pointer', () => {
    const target = row(true)
    const outcome = applyCiRunUrlCorrection(target, { stage: 'U', supplementSeq: undefined, to: right, reason: 'wrong owner', atUtc: 'now' })
    assertApplied(outcome)
    expect(target.cells.U?.ciRunUrl).toBe(right)
    // The decisive assertion. Correcting only the cell is what left four wrong
    // cells and four wrong copies disagreeing in the first place.
    expect(target.acceptedEvidence?.cells.U?.ciRunUrl).toBe(right)
    expect(outcome.rewritten).toEqual(['cells.U', 'acceptedEvidence.cells.U'])
  })

  it('REFUSES when the accepted-evidence copy names a different run, rather than guessing', () => {
    const target = row(true)
    target.acceptedEvidence!.cells.U!.ciRunUrl = `https://github.com/${PROGRAM_CI_REPO}/actions/runs/11111111111`
    const outcome = applyCiRunUrlCorrection(target, { stage: 'U', supplementSeq: undefined, to: right, reason: 'r', atUtc: 'now' })
    assertRefused(outcome)
    expect(outcome.reason).toContain('accepted against a different run')
    // And nothing moved: a refusal that had already written the cell would
    // leave the two halves disagreeing in the other direction.
    expect(target.cells.U?.ciRunUrl).toBe(wrong)
  })

  it('APPENDS each correction, so a second one cannot erase the record of the first', () => {
    const target = row(false)
    const once = applyCiRunUrlCorrection(target, { stage: 'U', supplementSeq: undefined, to: right, reason: 'wrong owner', atUtc: 't1' })
    assertApplied(once)
    const other = `https://github.com/${PROGRAM_CI_REPO}/actions/runs/${RUN}?`
    expect(checkCiRunUrlCorrection(right, other).ok).toBe(false)
    target.cells.U!.ciRunUrl = wrong
    const twice = applyCiRunUrlCorrection(target, { stage: 'U', supplementSeq: undefined, to: right, reason: 'and again', atUtc: 't2' })
    assertApplied(twice)
    expect(target.cells.U?.ciRunUrlCorrections).toHaveLength(2)
    expect(target.cells.U?.ciRunUrlCorrections?.map(entry => entry.reason)).toEqual(['wrong owner', 'and again'])
  })

  it('leaves the observation alone, because a correction is not a re-attestation', () => {
    const target = row(false)
    applyCiRunUrlCorrection(target, { stage: 'U', supplementSeq: '1', to: right, reason: 'wrong owner', atUtc: 'now' })
    // The supplement moved and the base cell did not, so the command targets
    // what it was told to target.
    expect(target.supplements['U.1']?.ciRunUrl).toBe(right)
    expect(target.cells.U?.ciRunUrl).toBe(wrong)
    // And nothing about the observation itself changed. `reattested` is what a
    // re-green writes; a correction must never produce one, because no second
    // observation happened.
    expect(target.supplements['U.1']?.candidateSha).toBe('abc')
    expect(target.cells.U?.outcome).toBe('passed')
    expect(target.supplements['U.1']?.reattested).toBeUndefined()
  })
})

describe('--correct-ci-run-url resolves cells in the REAL ledger, not only in a fixture', () => {
  it('finds every cell this correction targets, including the four supplements', () => {
    // **The case the eight above could not be.** They run against a fixture
    // this file builds, so they prove the lookup matches the shape its AUTHOR
    // assumed. That shape was wrong -- supplements are keyed `U.1`, flat, and
    // the lookup read `supplements.U[1]` -- and every one of the eight passed
    // while the command refused every real supplement with `no supplement 1 at
    // stage U`. The in-process probe that exercised the same assertions shared
    // the same fixture, so "the probe can go red" proved nothing about it: a
    // wrong fixture makes every instrument built on it agree.
    //
    // This one reads the committed ledger. It cannot be satisfied by a shape
    // nobody uses, and it is deliberately narrow: it asserts the lookup RESOLVES
    // and that what it resolves carries a `ciRunUrl`, never what that URL says.
    // The rows it names are the eight occurrences the correction exists for.
    // A cell revoked since then keeps the run of the observation it withdrew in
    // `revokedFrom`, and its key is still a real supplement key, so it stays.
    const ledger = JSON.parse(
      readFileSync(new URL('../../spec/first100/exec/ledger.json', import.meta.url), 'utf8'),
    ) as { rows: Record<string, unknown> }

    const targets: readonly { epic: string; stage: string; seq?: string }[] = [
      { epic: 'P4-01', stage: 'U', seq: '1' },
      { epic: 'P4-01', stage: 'U', seq: '2' },
      { epic: 'P4-02', stage: 'U' },
      { epic: 'P4-02', stage: 'F' },
      { epic: 'P4-02', stage: 'C', seq: '1' },
      { epic: 'P4-02', stage: 'P', seq: '1' },
    ]
    for (const target of targets) {
      const where = `${target.epic}.${target.stage}${target.seq === undefined ? '' : `.${target.seq}`}`
      const cell = cellForCorrection(ledger.rows[target.epic], target.stage, target.seq)
      expect(cell, `the ledger has a cell at ${where}; a lookup that cannot find it corrects nothing`).toBeDefined()
      const recorded = cell?.revokedFrom === undefined ? cell?.ciRunUrl : cell.revokedFrom.ciRunUrl
      expect(typeof recorded, `${where} carries a recorded run URL`).toBe('string')
    }
  })
})

describe('closureFailuresForAcceptedRows (BLOCKED-287)', () => {
  /** A ledger holding one row at a chosen status, sharing this file's closure fixtures. */
  const ledgerWith = (status: string, row: unknown) => ({ rows: { E1: { status, ...(row as object) } } })
  const closing = {
    cells: { C: { expectCasesMatched: ['case-a'] } },
    supplements: { 'F.1': { expectCasesMatched: ['case-b-supp'] } },
  }

  it('reports nothing when every ACCEPTED row closes', () => {
    expect(closureFailuresForAcceptedRows(ledgerWith('ACCEPTED', closing), registry, freeze, coverage)).toEqual([])
  })

  it('names the row when a citation loses its supplementSeq — the P4-07 defect, reintroduced', () => {
    // The citation resolves against `cells[stage]` instead of the supplement it
    // was observed in. Both are GREEN, which is why nothing looked wrong.
    const seqless = {
      entries: [
        coverage.entries[0],
        { epic: 'E1', acceptanceIndex: 1, coveredBy: [{ stage: 'F', title: 'case-b-supp' }] },
      ],
    }
    const failures = closureFailuresForAcceptedRows(ledgerWith('ACCEPTED', closing), registry, freeze, seqless)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.epic).toBe('E1')
    expect(failures[0]?.missingIndices).toEqual([1])
  })

  it('names the row when a citation carries a title nothing freezes — the P4-11 defect, reintroduced', () => {
    // A report prints the `describe` chain; the freeze stores the bare title.
    // Citing what the report printed matches no frozen entry.
    const prefixed = {
      entries: [
        { epic: 'E1', acceptanceIndex: 0, coveredBy: [{ stage: 'C', title: 'E1 suite case-a' }] },
        coverage.entries[1],
      ],
    }
    const failures = closureFailuresForAcceptedRows(ledgerWith('ACCEPTED', closing), registry, freeze, prefixed)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.missingIndices).toEqual([0])
  })

  it('leaves a row that is not ACCEPTED alone, however broken its citations', () => {
    // The precision half: this predicate guards rows nothing will re-accept. A
    // row still in flight belongs to the acceptance path, and reddening
    // `--check` for it would block the commit that is on its way to fixing it.
    const broken = { cells: { C: { expectCasesMatched: [] } }, supplements: {} }
    for (const status of ['NOT_RUN', 'BLOCKED_ON_ACCEPTANCE']) {
      expect(closureFailuresForAcceptedRows(ledgerWith(status, broken), registry, freeze, coverage)).toEqual([])
    }
  })

  it('reports a throw as a failure of that row rather than dying on it', () => {
    // `checkCoverageClosure` throws on a freeze entry whose supplement keys
    // disagree. A gate naming the row beats a stack trace, and the exit code is
    // the same either way.
    const badFreeze = { entries: [{ epic: 'E1', stage: 'C', supplementSeq: 1, expectCases: ['case-a'] }] }
    const failures = closureFailuresForAcceptedRows(ledgerWith('ACCEPTED', closing), registry, badFreeze, coverage)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.epic).toBe('E1')
    expect(failures[0]?.error).toBeDefined()
  })

  it('REFUSES when the coverage file is absent and rows are ACCEPTED, rather than skipping', () => {
    // The hole this gate was first written with: both coverage blocks were
    // guarded by an existence test alone, so a missing artifact skipped its own
    // check and `--check` still printed its success line -- "holds for all 0
    // ACCEPTED rows" over a ledger holding 26 of them. An absent observation is
    // a FAIL, and that rule has to hold inside the gate that enforces it.
    expect(coverageArtifactDrift(26, false, true)).toMatch(/26 row\(s\) are ACCEPTED/u)
    expect(coverageArtifactDrift(1, false, false)).toBeDefined()
  })

  it('REFUSES when the schema is absent, because then nothing validates the shape', () => {
    expect(coverageArtifactDrift(26, true, false)).toMatch(/nothing validates its shape/u)
  })

  it('proceeds when there is nothing to check, so the count of 0 is true rather than omitted', () => {
    // The precision half. A ledger with no ACCEPTED row and no coverage file is
    // not drift -- it is a program that has accepted nothing yet.
    expect(coverageArtifactDrift(0, false, false)).toBeUndefined()
    expect(coverageArtifactDrift(26, true, true)).toBeUndefined()
  })

  it('closes over the COMMITTED files, not only the fixtures in this file', () => {
    // The lesson the flat-key defect taught: eight green cases agreed with each
    // other because they shared one wrong fixture, and the real file had a
    // different shape. This case reads what is actually in the tree.
    const read = (path: string): unknown =>
      JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as unknown
    const ledger = read('../../spec/first100/exec/ledger.json') as { rows: Record<string, { status: string }> }
    const accepted = Object.values(ledger.rows).filter(row => row.status === 'ACCEPTED')
    expect(accepted.length).toBeGreaterThan(0)
    expect(closureFailuresForAcceptedRows(
      ledger,
      read('../../tests/first100/registry.json'),
      read('../../spec/first100/exec/command-freeze.json'),
      read('../../spec/first100/exec/acceptance-coverage.json'),
    )).toEqual([])
  })
})

/** One step of `first100-exact-sha.yml`'s gate job, in the fields the cases below read. */
interface GateStep {
  readonly name?: string
  readonly run?: string
  readonly with?: { readonly name?: string; readonly path?: string }
}

describe('the exact-SHA observation artifact carries the json report of every step that runs its own vitest config', () => {
  // An entry frozen under a config of its own (`vitest.e2e.config.ts` for P4-05.U.4, `vitest.snapshot.config.ts`) is
  // observed by the report its step writes: the full-suite run uses the default config, which includes no `*.e2e.ts`
  // or `*.snapshot.ts` file. `--supplement` reads that report from the artifact the gate job uploads, so the step has
  // to write it and the upload has to carry it.
  const workflow = load(readFileSync(new URL('../../.github/workflows/first100-exact-sha.yml', import.meta.url), 'utf8')) as {
    jobs: Record<string, { steps: GateStep[] }>
  }
  const steps = workflow.jobs['exact-sha-gate']?.steps ?? []
  const own = steps.filter(step => /--config vitest\.[a-z0-9]+\.config\.ts/u.test(step.run ?? ''))
  const upload = steps.findIndex(step => step.with?.name?.startsWith('first100-vitest-report-') === true)

  it('writes a json report under the observations directory from each step that runs its own config', () => {
    expect(own.length).toBeGreaterThan(0)
    for (const step of own) {
      expect(step.run).toMatch(/--reporter=json --outputFile=\.artifacts\/first100\/observations\/vitest-[a-z0-9-]+\.json(?:\s|$)/u)
    }
  })

  it('runs the recorded-session snapshots under their own config with a json report', () => {
    const snapshots = steps.find(step => step.name === 'Recorded-session snapshots')
    expect(snapshots?.run).toContain('--config vitest.snapshot.config.ts')
    expect(snapshots?.run).toContain('--reporter=json --outputFile=.artifacts/first100/observations/vitest-snapshot.json')
  })

  it('uploads each of those reports beside the full-suite report, after the step that writes it', () => {
    const uploaded = steps[upload]?.with?.path?.split('\n').map(line => line.trim()) ?? []
    expect(uploaded).toContain('.artifacts/first100/observations/vitest-report.json')
    for (const step of own) {
      expect(uploaded).toContain(/--outputFile=(\S+)/u.exec(step.run ?? '')?.[1])
      expect(steps.indexOf(step)).toBeLessThan(upload)
    }
  })

  it('signs every report the artifact carries in the evidence job, which downloads it to the same paths (B5)', () => {
    const uploaded = steps[upload]?.with?.path?.split('\n').map(line => line.trim()).filter(Boolean) ?? []
    const signing = workflow.jobs['first100-evidence']?.steps
      .find(step => step.name?.startsWith('Sign the vitest observation report') === true)
    const signed = [...(signing?.run ?? '').matchAll(/attest\.ts --sign (\S+)/gu)].map(match => match[1])
    expect(signed.sort()).toStrictEqual(uploaded.sort())
  })

  it('writes each report\'s step exit code beside the report and exits with it, and uploads that record (BLOCKED-326)', () => {
    const uploaded = steps[upload]?.with?.path?.split('\n').map(line => line.trim()) ?? []
    const writers = steps.filter(step => /--outputFile=\.artifacts\/first100\/observations\/\S+\.json/u.test(step.run ?? ''))
    expect(writers.length).toBeGreaterThan(0)
    for (const step of writers) {
      const lines = (step.run ?? '').split('\n')
      const record = `${/--outputFile=(\S+)\.json/u.exec(step.run ?? '')?.[1] ?? ''}.exit.json`
      expect(lines[lines.findIndex(line => line.includes('--outputFile=')) + 1]).toBe('code=$?')
      expect(lines).toContain(`printf '{"exitCode": %d}\\n' "$code" > ${record}`)
      expect(step.run).toMatch(/\nexit \$code\n?$/u)
      expect(uploaded).toContain(record)
    }
  })
})

describe('configFrozenReportRefusal: --supplement observes an entry frozen under its own config through that run\'s report', () => {
  const acp = 'apps/cli/tests/profiles/acp/tests/acp.e2e.ts'
  const e2eFrozen = ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', acp]
  const fullSuite = ['/home/runner/work/r/r/apps/cli/tests/process-shutdown.spec.ts', '/home/runner/work/r/r/packages/g/p/tests/a.spec.ts']

  it('refuses the full-suite report for an entry frozen under the e2e config, naming both configs', () => {
    expect(configFrozenReportRefusal(e2eFrozen, fullSuite, 'obs/vitest-report.json'))
      .toBe('the entry is frozen under --config vitest.e2e.config.ts, and vitest-report.json is the report of the default config')
  })

  it('takes a snapshot-frozen entry (P2-04 U.3\'s argv) from the snapshot step\'s report, which also runs other files', () => {
    const headless = 'snapshots/session/headless.snapshot.ts'
    const sdk = 'snapshots/sdk/sdk.snapshot.ts'
    const argv = ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.snapshot.config.ts', headless, sdk, '--reporter=json']
    const snapshotReport = 'obs/vitest-snapshot.json'
    expect(configFrozenReportRefusal(argv, fullSuite, snapshotReport)).toBe(
      `the entry is frozen under --config vitest.snapshot.config.ts, and the report ran none of ${headless}, ${sdk}; `
      + 'its observation is the report its own step in first100-exact-sha.yml writes beside the full-suite report',
    )
    const snapshotStep = [headless, sdk, 'snapshots/acp/acp.snapshot.ts', 'apps/web/tests/minimal-preset.snapshot.ts']
    expect(configFrozenReportRefusal(argv, snapshotStep.map(path => `/home/runner/work/r/r/${path}`), snapshotReport)).toBeNull()
  })

  it('accepts the report the entry\'s own e2e command wrote', () => {
    expect(configFrozenReportRefusal(e2eFrozen, [`/home/runner/work/r/r/${acp}`], 'obs/vitest-e2e-acp.json')).toBeNull()
  })

  it('reads the -c spelling of the config, wherever it sits in the argv', () => {
    const shortForm = ['pnpm', 'exec', 'vitest', 'run', 'packages/g/p/tests/x.e2e.ts', '-c', 'vitest.e2e.config.ts', '--reporter=json']
    expect(configFrozenReportRefusal(shortForm, fullSuite, 'obs/vitest-e2e-workflow.json')).toMatch(
      /^the entry is frozen under --config vitest\.e2e\.config\.ts, and the report ran none of packages\/g\/p\/tests\/x\.e2e\.ts;/u,
    )
  })

  it('leaves an entry frozen under the default config to the full-suite report, whatever that report ran', () => {
    const argv = ['pnpm', 'exec', 'vitest', 'run', 'packages/g/q/tests/b.spec.ts', '--reporter=json']
    expect(configFrozenReportRefusal(argv, fullSuite, 'obs/vitest-report.json')).toBeNull()
  })

  it('refuses another config\'s report for an entry frozen under its own config, though that report ran its file', () => {
    expect(configFrozenReportRefusal(e2eFrozen, [`/home/runner/work/r/r/${acp}`], 'obs/vitest-snapshot.json'))
      .toBe('the entry is frozen under --config vitest.e2e.config.ts, '
        + 'and vitest-snapshot.json is the report of --config vitest.snapshot.config.ts')
  })

  it('refuses every report but vitest-report.json for an entry frozen under the default config', () => {
    const argv = ['pnpm', 'exec', 'vitest', 'run', 'packages/g/p/tests/a.spec.ts', '--reporter=json']
    expect(configFrozenReportRefusal(argv, fullSuite, 'obs/vitest-e2e-acp.json'))
      .toBe('the entry is frozen under the default config, and vitest-e2e-acp.json is the report of --config vitest.e2e.config.ts')
  })

  it('refuses a report whose name no step in first100-exact-sha.yml writes, since the name is how its config is known', () => {
    expect(configFrozenReportRefusal(e2eFrozen, [`/home/runner/work/r/r/${acp}`], 'obs/vitest-e2e-web.json'))
      .toBe('no step in first100-exact-sha.yml writes a report named vitest-e2e-web.json, so the config it ran under is unknown')
  })

  it('refuses an argv naming a config and no test path, as the uniqueness gate does', () => {
    const argv = ['pnpm', 'exec', 'vitest', 'run', '-c', 'vitest.snapshot.config.ts', '--reporter=json']
    expect(configFrozenReportRefusal(argv, fullSuite, 'obs/vitest-snapshot.json'))
      .toBe('the entry names --config vitest.snapshot.config.ts and no test path, so no report can be told to be its own')
  })

  it('reads the -c=<path> spelling of the config, which vitest also accepts', () => {
    expect(frozenCommand(['pnpm', 'exec', 'vitest', 'run', '-c=vitest.e2e.config.ts', acp]))
      .toStrictEqual({ config: 'vitest.e2e.config.ts', paths: [acp] })
  })
})

/**
 * A scratch repository holding one commit and a copy of this directory's modules, so a run of `generate-ledger.mjs`
 * in it neither reads nor writes this repository's ledger.
 * @returns the repository's real path, its commit, and the path of its copy of `generate-ledger.mjs`.
 */
function scratchLedgerRepo(): { root: string; sha: string; script: string } {
  // The real path, because the script runs its CLI only when argv[1] equals its own module path.
  const root = realpathSync(makeGitFixture())
  const sha = commit(root, 'fixture', 'fixture\n')
  mkdirSync(join(root, 'scripts/first100'), { recursive: true })
  for (const name of readdirSync(new URL('.', import.meta.url)).filter(file => file.endsWith('.mjs'))) {
    copyFileSync(new URL(name, import.meta.url), join(root, 'scripts/first100', name))
  }
  symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'))
  mkdirSync(join(root, 'spec/first100/exec'), { recursive: true })
  return { root, sha, script: join(root, 'scripts/first100/generate-ledger.mjs') }
}

/**
 * Runs `generate-ledger.mjs` in a scratch repository holding a freeze of `entry` alone and one report.
 * @param entry - the freeze's only entry.
 * @param report - the report's file name, the test files it ran, and the exit code its step records beside it (0 when
 *   omitted); it sits in a directory named after the scratch repository's commit, which is the candidate.
 * @param cellArgs - the arguments naming the cell; `--report`, `--ci-run-url` and `--candidate-sha` follow them.
 * @returns the exit status, the stdout and stderr together, and the `--report` argument.
 */
function runLedgerInScratchRepo(
  entry: Record<string, unknown>,
  report: { name: string; files: readonly string[]; exitCode?: number },
  cellArgs: readonly string[],
): { status: number | null; output: string; reportPath: string } {
  const { root, sha, script } = scratchLedgerRepo()
  writeFileSync(join(root, 'spec/first100/exec/command-freeze.json'), JSON.stringify({ entries: [entry] }))
  mkdirSync(join(root, sha))
  const reportPath = `${sha}/${report.name}`
  const testResults = report.files.map(name => ({ name, assertionResults: [] }))
  writeFileSync(join(root, reportPath), JSON.stringify({ success: true, testResults }))
  writeFileSync(join(root, reportPath.replace(/\.json$/u, '.exit.json')), JSON.stringify({ exitCode: report.exitCode ?? 0 }))
  const ciRunUrl = `https://github.com/${PROGRAM_CI_REPO}/actions/runs/1`
  const args = [...cellArgs, '--report', reportPath, '--ci-run-url', ciRunUrl, '--candidate-sha', sha]
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}`, reportPath }
}

/** P4-05.U frozen under the e2e config, as a base entry. */
const e2eBase = {
  epic: 'P4-05',
  stage: 'U',
  argv: ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', 'apps/cli/tests/a.e2e.ts'],
  expectCases: ['acp host takes over the Run'],
  expectExit: 0,
}

describe('generate-ledger.mjs greens a cell only from a report of the config its entry is frozen under', () => {
  it('refuses the full-suite report for a base entry frozen under the e2e config', () => {
    const { status, output, reportPath } = runLedgerInScratchRepo(
      e2eBase,
      { name: 'vitest-report.json', files: ['/ci/packages/g/p/tests/a.spec.ts'] },
      ['--epic', 'P4-05', '--stage', 'U'],
    )
    expect(output).toContain(`BLOCKED: --report ${reportPath} cannot observe P4-05.U: the entry is frozen under --config `
      + 'vitest.e2e.config.ts, and vitest-report.json is the report of the default config')
    expect(status).toBe(1)
  })

  it('--supplement exits 1 with BLOCKED for an entry frozen under the e2e config and an e2e report that did not run its path', () => {
    const { status, output, reportPath } = runLedgerInScratchRepo(
      { ...e2eBase, supplementSeq: 4, supplements: { epic: 'P4-05', stage: 'U' } },
      { name: 'vitest-e2e-acp.json', files: ['/ci/apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts'] },
      ['--supplement', '--epic', 'P4-05', '--stage', 'U', '--supplement-seq', '4'],
    )
    expect(output).toContain(`BLOCKED: --report ${reportPath} cannot observe P4-05.U.4: the entry is frozen under --config `
      + 'vitest.e2e.config.ts, and the report ran none of apps/cli/tests/a.e2e.ts;')
    expect(status).toBe(1)
  })
})

describe('recordedExitRefusal: a report greens a cell only when its step recorded process exit 0 (BLOCKED-326)', () => {
  // Vitest can exit 1 on an unhandled error outside any case while its json report says `success: true` (run
  // 36001656822, step 18), so the exit code the step records beside the report decides, not the report.
  /**
   * A report that says `success: true`, in a directory of its own.
   * @param exitRecord - the text of the exit record beside it, or `undefined` for none.
   * @returns the report's path.
   */
  function reportBeside(exitRecord: string | undefined): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-exit-record-'))
    fixtureRoots.push(root)
    writeFileSync(join(root, 'vitest-report.json'), JSON.stringify({ success: true, testResults: [] }))
    if (exitRecord !== undefined) writeFileSync(join(root, 'vitest-report.exit.json'), exitRecord)
    return join(root, 'vitest-report.json')
  }
  const remedy = 'pass --exit-override "<reason>" to record the cell anyway'

  it('refuses a report with no exit record beside it', () => {
    const reportPath = reportBeside(undefined)
    expect(recordedExitRefusal(reportPath, undefined)).toBe(`${reportPath.replace(/\.json$/u, '.exit.json')} does not exist, `
      + `so the process exit of the step that wrote the report is unknown; ${remedy}`)
  })

  it('refuses an exit record that holds no integer exitCode', () => {
    for (const text of ['{"exitCode":"0"}', '{"exitCode":0.5}', '{}', 'null', 'not json']) {
      const reportPath = reportBeside(text)
      expect(recordedExitRefusal(reportPath, undefined)).toBe(`${reportPath.replace(/\.json$/u, '.exit.json')} records no integer `
        + `exitCode, so the process exit of the step that wrote the report is unknown; ${remedy}`)
    }
  })

  it('refuses a report that says success: true when its step recorded exit code 1', () => {
    const reportPath = reportBeside('{"exitCode":1}')
    expect(recordedExitRefusal(reportPath, undefined))
      .toBe(`${reportPath.replace(/\.json$/u, '.exit.json')} records exit code 1 for the step that wrote the report; ${remedy}`)
  })

  it('accepts a report whose step recorded exit code 0', () => {
    expect(recordedExitRefusal(reportBeside('{"exitCode":0}'), undefined)).toBeNull()
  })

  it('lets a non-empty --exit-override reason lift the refusal of a missing, malformed or non-zero record', () => {
    for (const text of [undefined, 'not json', '{"exitCode":1}']) {
      expect(recordedExitRefusal(reportBeside(text), 'delegate ruling, gate3 log 2026-09-24T13:41:16Z')).toBeNull()
    }
  })

  it('lifts nothing with a blank --exit-override reason', () => {
    expect(recordedExitRefusal(reportBeside('{"exitCode":1}'), ' ')).not.toBeNull()
  })
})

describe('generate-ledger.mjs refuses to green a cell from a report whose step recorded a non-zero exit (BLOCKED-326)', () => {
  const failedStep = { name: 'vitest-e2e-acp.json', files: ['/ci/apps/cli/tests/a.e2e.ts'], exitCode: 1 }
  const refusal = (reportPath: string, cell: string): string => `BLOCKED: --report ${reportPath} cannot green ${cell}: `
    + `${reportPath.replace(/\.json$/u, '.exit.json')} records exit code 1 for the step that wrote the report;`

  it('--supplement exits 1 with BLOCKED for a report that says success: true beside an exit record of 1', () => {
    const { status, output, reportPath } = runLedgerInScratchRepo(
      { ...e2eBase, supplementSeq: 4, supplements: { epic: 'P4-05', stage: 'U' } },
      failedStep,
      ['--supplement', '--epic', 'P4-05', '--stage', 'U', '--supplement-seq', '4'],
    )
    expect(output).toContain(refusal(reportPath, 'P4-05.U.4'))
    expect(status).toBe(1)
  })

  it('the base cell exits 1 with BLOCKED for a report that says success: true beside an exit record of 1', () => {
    const { status, output, reportPath } = runLedgerInScratchRepo(e2eBase, failedStep, ['--epic', 'P4-05', '--stage', 'U'])
    expect(output).toContain(refusal(reportPath, 'P4-05.U'))
    expect(status).toBe(1)
  })
})

describe('generate-ledger.mjs --check does not apply the BLOCKED-326 exit refusal to a cell greened before it', () => {
  it('passes a ledger whose GREEN cell absorbed flakes, has no exitOverride, and has no exit record beside its report', () => {
    // Twelve cells were greened under BLOCKED-007 item 3 before the exit record existed. The delegate ruled on
    // 2026-09-24 that only a cell being recorded is checked, so --check does not turn red over them.
    const { root, script } = scratchLedgerRepo()
    const observationReportPath = 'ci-run-1/vitest-report.json'
    mkdirSync(join(root, 'ci-run-1'))
    writeFileSync(join(root, observationReportPath), JSON.stringify({ success: false, testResults: [] }))
    const cell = { status: 'GREEN', observationReportPath, absorbedFlakes: ['suite known flake test'] }
    writeFileSync(join(root, 'spec/first100/exec/ledger.json'), JSON.stringify({
      generatedBy: 'scripts/first100/generate-ledger.mjs',
      rows: { 'P4-05': { status: 'BLOCKED_ON_ACCEPTANCE', cells: { U: cell }, supplements: {} } },
    }))
    const result = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' })
    expect(`${result.stdout}${result.stderr}`).toContain('verify: ')
    expect(result.status).toBe(0)
  })
})

describe('generate-ledger.mjs --accept does not apply the BLOCKED-326 exit refusal to a cell greened before it', () => {
  it('accepts a row whose one applicable cell absorbed flakes, has no exitOverride, and has no exit record beside its report', () => {
    // A row holding one of those twelve cells stays acceptable under the same ruling. The fixture gives every other
    // --accept predicate what it reads, so an exit-record check is the only thing that could refuse the row.
    const { root, script } = scratchLedgerRepo()
    const title = 'acp host takes over the Run'
    const notApplicable = { nOf: 'N/A' }
    const stages = { C: notApplicable, P: notApplicable, U: { nOf: 1 }, F: notApplicable }
    const documents: Record<string, unknown> = {
      'tests/first100/registry.json': { epics: [{ id: 'P4-05', acceptance: [title], stages }] },
      'tests/first100/adjudication.json': {},
      'spec/first100/exec/command-freeze.json': { entries: [e2eBase] },
      'spec/first100/exec/acceptance-coverage.json': { entries: [{ epic: 'P4-05', acceptanceIndex: 0, coveredBy: [{ stage: 'U', title }] }] },
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
    const candidateSha = commit(root, 'candidate', 'candidate\n')
    const observationReportPath = 'ci-run-1/vitest-e2e-acp.json'
    mkdirSync(join(root, 'ci-run-1'))
    writeFileSync(join(root, observationReportPath), JSON.stringify({ success: false, testResults: [] }))
    const cell = {
      status: 'GREEN',
      candidateSha,
      ciRunUrl: `https://github.com/${PROGRAM_CI_REPO}/actions/runs/1`,
      observationReportPath,
      observationSha256: 'fixture',
      expectCasesMatched: [title],
      absorbedFlakes: ['suite known flake test'],
    }
    const row = {
      id: 'P4-05',
      title: 'fixture',
      layer: 'orchestration-runtime',
      canonicalOwner: 'fixture',
      predecessors: [],
      wave: 4,
      cells: { U: cell },
      supplements: {},
      candidateSha,
      independentVerdict: 'PENDING',
      openFindings: [],
      status: 'BLOCKED_ON_ACCEPTANCE',
    }
    const ledger = { generatedBy: 'scripts/first100/generate-ledger.mjs', rows: { 'P4-05': row } }
    writeFileSync(join(root, 'spec/first100/exec/ledger.json'), JSON.stringify(ledger))
    const signoff = { epic: 'P4-05', conclusion: 'PASS', rowDigestSha256: rowDigest(row), delegateSession: 'fixture', signedAtUtc: '2026-09-24T00:00:00Z' }
    writeFileSync(join(root, 'spec/first100/exec/delegate-signoff.json'), JSON.stringify({ entries: [signoff] }))
    const result = spawnSync(process.execPath, [script, '--accept', '--epic', 'P4-05'], { cwd: root, encoding: 'utf8' })
    expect(`${result.stdout}${result.stderr}`).toContain('ACCEPTED P4-05: independentVerdict=APPROVED, status=ACCEPTED')
    expect(result.status).toBe(0)
  })
})

describe('generate-ledger.mjs --revoke-cell --supplement-seq withdraws a supplement whose observation holds no live entry of its own', () => {
  const OBSERVED_AT = '2026-09-24T15:26:35Z'
  const REFROZEN_AT = '2026-09-24T18:18:22Z'
  const OLD_TITLE = 'rejects a declare-module block declaring a const named Context'
  const NEW_TITLE = 'rejects a declare-module block declaring a class named Context'
  const REASON = 'the entry was re-frozen at its seq under a changed title'
  const CI_RUN_URL = `https://github.com/${PROGRAM_CI_REPO}/actions/runs/1`

  type FreezeEntry = {
    epic: string
    stage: string
    supplementSeq: number
    expectCases: string[]
    supersededBy?: string
    [field: string]: unknown
  }

  /** P0-04 U.1 frozen under one title. */
  const supplementEntry = (title: string, frozenAtUtc: string): FreezeEntry => ({
    epic: 'P0-04',
    stage: 'U',
    supplements: { epic: 'P0-04', stage: 'U' },
    supplementSeq: 1,
    argv: ['pnpm', 'exec', 'vitest', 'run', 'tests/architecture/check-layer-deps.spec.ts', '--reporter=json'],
    expectExit: 0,
    expectCases: [title],
    frozenAtUtc,
  })
  /** [363]'s replacement in batch 7: the same seq, a changed title. */
  const refrozen: FreezeEntry[] = [
    { ...supplementEntry(OLD_TITLE, OBSERVED_AT), supersededBy: REFROZEN_AT },
    { ...supplementEntry(NEW_TITLE, REFROZEN_AT), supersedes: OBSERVED_AT },
  ]

  type Ledger = {
    rows: Record<string, { id: string; status: string; independentVerdict: string; supplements: Record<string, LedgerRecord> }>
  }
  type LedgerRecord = { status: string; candidateSha?: string; revokedFrom?: unknown; revokedReason?: string }

  /**
   * A scratch repository whose commit holds a freeze of P0-04 U.1 under the old title, and a ledger in which that
   * supplement is GREEN from an observation of that commit. The row has no main U cell, so only the supplement can be
   * withdrawn.
   * @param record - fields that replace the GREEN record's, or `null` for a row with no record for U.1.
   * @returns the repository's root and script, the observed commit, and a writer of the working freeze.
   */
  function revocationRepo(record: Record<string, unknown> | null = {}): {
    root: string
    script: string
    observed: string
    writeFreeze: (entries: readonly FreezeEntry[]) => void
  } {
    const { root, script } = scratchLedgerRepo()
    const writeFreeze = (entries: readonly FreezeEntry[]): void => {
      writeFileSync(join(root, 'spec/first100/exec/command-freeze.json'), JSON.stringify({ entries }))
    }
    writeFreeze([supplementEntry(OLD_TITLE, OBSERVED_AT)])
    const observed = commit(root, 'observed', 'observed\n')
    const green = {
      status: 'GREEN',
      candidateSha: observed,
      ciRunUrl: CI_RUN_URL,
      observationReportPath: 'ci-run-1/vitest-report.json',
      observationSha256: 'fixture',
      expectCasesMatched: [OLD_TITLE],
      capturedAtUtc: OBSERVED_AT,
      ...record,
    }
    const row = {
      id: 'P0-04',
      title: 'fixture',
      layer: 'governance',
      canonicalOwner: 'fixture',
      predecessors: [],
      wave: 0,
      cells: {},
      supplements: record === null ? {} : { 'U.1': green },
      independentVerdict: 'PENDING',
      openFindings: [],
      status: 'BLOCKED_ON_ACCEPTANCE',
    }
    writeFileSync(join(root, 'spec/first100/exec/ledger.json'), JSON.stringify({ generatedBy: 'scripts/first100/generate-ledger.mjs', rows: { 'P0-04': row } }))
    return { root, script, observed, writeFreeze }
  }

  const revoke = (root: string, script: string): { status: number | null; output: string } => {
    const args = ['--revoke-cell', '--epic', 'P0-04', '--stage', 'U', '--supplement-seq', '1', '--reason', REASON]
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  }
  const ledgerOf = (root: string): Ledger => JSON.parse(readFileSync(join(root, 'spec/first100/exec/ledger.json'), 'utf8')) as Ledger

  it('refuses a supplement whose observed tree holds its live entry', () => {
    const { root, script, observed } = revocationRepo()

    const { status, output } = revoke(root, script)
    expect(output).toContain(`BLOCKED: P0-04.U.1's observation ${observed.slice(0, 10)} DOES contain its live freeze entries, so this cell is not revocable`)
    expect(status).toBe(1)
    expect(ledgerOf(root).rows['P0-04']!.supplements['U.1']!.status).toBe('GREEN')
  })

  it('withdraws a supplement re-frozen at its seq under a changed title, as it withdraws a main cell', () => {
    const { root, script, observed, writeFreeze } = revocationRepo()
    writeFreeze(refrozen)

    const { status, output } = revoke(root, script)
    expect(output).toContain(`revoked P0-04.U.1: 1 live freeze entry/entries absent from ${observed.slice(0, 10)}`)
    expect(status).toBe(0)
    const row = ledgerOf(root).rows['P0-04']!
    expect(row.supplements['U.1']).toStrictEqual({
      status: 'NOT_RUN',
      revokedFrom: { candidateSha: observed, ciRunUrl: CI_RUN_URL, absentCommitments: 1 },
      revokedReason: REASON,
    })
    expect([row.status, row.independentVerdict]).toStrictEqual(['NOT_RUN', 'PENDING'])
  })

  it.each([
    ['a record that is not GREEN', { status: 'SUPERSEDED' }, 'BLOCKED: P0-04.U.1 is SUPERSEDED, not GREEN'],
    ['no record at all', null, 'BLOCKED: P0-04.U.1 has no cell to revoke'],
  ])('refuses a supplement with %s', (_label, record, refusal) => {
    const { root, script, writeFreeze } = revocationRepo(record)
    writeFreeze(refrozen)

    const { status, output } = revoke(root, script)
    expect(output).toContain(refusal)
    expect(status).toBe(1)
  })

  it('leaves nothing the tree check reports, and nothing the liveness derivation turns back', () => {
    const { root, script, observed, writeFreeze } = revocationRepo()
    writeFreeze(refrozen)
    const live = refrozen.filter(entry => entry.supersededBy === undefined)
    const freezeAt = (sha: string): CandidateTreeFreezeEntry[] =>
      (JSON.parse(git(root, ['show', `${sha}:spec/first100/exec/command-freeze.json`])) as { entries: CandidateTreeFreezeEntry[] }).entries
    // The control: before the withdrawal the check reports the supplement, so its silence after is the withdrawal's.
    expect(candidateTreeFindings(ledgerOf(root).rows, live, freezeAt).missing.map(finding => finding.text))
      .toStrictEqual([`P0-04.U.1: 1 live freeze entry/entries absent from ${observed.slice(0, 10)}`])

    expect(revoke(root, script).status).toBe(0)
    const { rows } = ledgerOf(root)
    expect(candidateTreeFindings(rows, live, freezeAt).missing).toStrictEqual([])
    deriveSupplementLiveness(rows, refrozen)
    expect(rows['P0-04']!.supplements['U.1']!.status).toBe('NOT_RUN')
  })
})

describe('REPORT_CONFIGS names exactly the observation reports first100-exact-sha.yml writes', () => {
  it('maps each written report to the --config of the step that writes it, and names no other report', () => {
    const text = readFileSync(new URL('../../.github/workflows/first100-exact-sha.yml', import.meta.url), 'utf8')
    const jobs = (load(text) as { jobs: Record<string, { steps?: { run?: string }[] }> }).jobs
    const written = new Map<string, string | undefined>()
    for (const run of Object.values(jobs).flatMap(job => (job.steps ?? []).map(step => step.run ?? ''))) {
      for (const command of run.replace(/\\\n/gu, ' ').split('\n')) {
        const name = /--outputFile=\.artifacts\/first100\/observations\/(\S+\.json)/u.exec(command)?.[1]
        if (name !== undefined) written.set(name, frozenCommand(command.trim().split(/\s+/u)).config)
      }
    }
    expect(written.size).toBeGreaterThan(0)
    expect(new Map(REPORT_CONFIGS)).toStrictEqual(written)
  })
})
