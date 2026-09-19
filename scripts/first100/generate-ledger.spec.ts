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
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { CiRunUrlCorrectionResult, CiRunUrlCorrectionVerdict } from './generate-ledger.mjs'
import {
  acceptPreflightFindings,
  applyCiRunUrlCorrection,
  checkCandidateChainConsistency,
  checkCiRunUrlCorrection,
  checkCoverageClosure,
  checkDelegateSignoff,
  checkFailureSetAgainstFlakeRegistry,
  execStateDigestDrift,
  findAmbiguousCaseMatches,
  findDuplicateFrozenCases,
  p9ItemsSettled,
  parseCiRunUrl,
  PROGRAM_CI_REPO,
  reattestationOf,
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
    supplements: Record<string, Record<string, CorrectableCell>>
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
      supplements: { U: { 1: { status: 'GREEN', ciRunUrl: wrong, candidateSha: 'abc' } } },
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
    expect(target.supplements.U?.[1]?.ciRunUrl).toBe(right)
    expect(target.cells.U?.ciRunUrl).toBe(wrong)
    // And nothing about the observation itself changed. `reattested` is what a
    // re-green writes; a correction must never produce one, because no second
    // observation happened.
    expect(target.supplements.U?.[1]?.candidateSha).toBe('abc')
    expect(target.cells.U?.outcome).toBe('passed')
    expect(target.supplements.U?.[1]?.reattested).toBeUndefined()
  })
})
