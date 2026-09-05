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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkCandidateChainConsistency,
  checkCoverageClosure,
  checkDelegateSignoff,
  checkFailureSetAgainstFlakeRegistry,
  findAmbiguousCaseMatches,
  checkObservationDistinctness,
  rowDigest,
} from './generate-ledger.mjs'

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
