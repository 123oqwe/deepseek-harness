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
 *     supplements.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkCandidateChainConsistency,
  checkCoverageClosure,
  checkFailureSetAgainstFlakeRegistry,
  checkObservationDistinctness,
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
  it('green: every cell and supplement observation is pairwise distinct', () => {
    const row = {
      cells: { C: { observationSha256: 'sha-c' }, F: { observationSha256: 'sha-f' } },
      supplements: { 'F.1': { observationSha256: 'sha-f-supp' } },
    }
    expect(checkObservationDistinctness(row, ['C', 'F'])).toEqual({ valid: true, conflicts: [] })
  })

  it('red: a cell and a supplement sharing one observation file is rejected (B7① row-level recheck)', () => {
    const row = {
      cells: { C: { observationSha256: 'shared-sha' }, F: { observationSha256: 'sha-f' } },
      supplements: { 'F.1': { observationSha256: 'shared-sha' } },
    }
    const result = checkObservationDistinctness(row, ['C', 'F'])
    expect(result.valid).toBe(false)
    expect(result.conflicts).toEqual([['C', 'F.1']])
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
