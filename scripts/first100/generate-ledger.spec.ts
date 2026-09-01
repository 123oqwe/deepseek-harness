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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { checkCandidateChainConsistency, checkCoverageClosure, checkObservationDistinctness } from './generate-ledger.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

function head(ref: string): string {
  return execFileSync('git', ['rev-parse', ref], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
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

  it('green: distinct SHAs that form a real linear git ancestry chain (this repo\'s own history) are valid', () => {
    const older = head('a8378e81ec~1')
    const newer = head('a8378e81ec')
    const row = { cells: { C: { candidateSha: older }, F: { candidateSha: newer } } }
    const result = checkCandidateChainConsistency(row, ['C', 'F'])
    expect(result.valid).toBe(true)
    expect(result.divergentPairs).toEqual([])
  })

  it('red: two commits with no ancestry relationship (genuinely divergent) are rejected', () => {
    // the repo's very first commit and a random later commit on an unrelated
    // lineage are not ancestor-related in either direction is not guaranteed
    // in a real repo (everything descends from init) -- so instead construct
    // two real, unrelated root-ish points is unreliable; use two commits we
    // know are NOT ancestor-related by picking one commit and a sibling from
    // a different, non-overlapping branch tip is out of scope for a unit
    // test without a fixture repo. Exercise the negative path directly
    // against the pure function's own ancestry check with fabricated (but
    // real, unrelated) SHA-shaped strings that git will report as "not an
    // ancestor" (spawnSync exits non-zero for unknown objects too, which the
    // implementation treats the same as "not an ancestor" -- documented,
    // conservative fail-closed behavior).
    const row = { cells: { C: { candidateSha: '1'.repeat(40) }, F: { candidateSha: '2'.repeat(40) } } }
    const result = checkCandidateChainConsistency(row, ['C', 'F'])
    expect(result.valid).toBe(false)
    expect(result.divergentPairs).toEqual([['1'.repeat(40), '2'.repeat(40)]])
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
