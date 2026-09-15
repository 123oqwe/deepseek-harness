/**
 * Unit coverage for the BLOCKED-106 recomputation gate's pure decisions.
 *
 * The gate's value is that it re-derives a cell's contents from the artifact
 * instead of inspecting how the fields look, so these cases pin the two
 * decisions that carry that: which file counts as the artifact, and which
 * frozen cases the artifact actually confirms.
 */
import { describe, expect, it } from 'vitest'

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  checkCellAgainstObservation, frozenCasesByOrigin, liveFreezeByStage, partitionFindings,
  recomputeMatchedCases, rescuedArtifactPaths, selectArtifactByDigest,
} from './verify-cells-recomputable.mjs'

describe('selectArtifactByDigest (BLOCKED-106, 2026-09-06)', () => {
  // A real `first100-exact-sha.yml` run uploads two files with this name, and
  // the cell's digest was taken over the `first100-evidence-*` one. These are
  // the real P0-01.C digests, truncated.
  const candidates = [
    { path: 'first100-vitest-report-8d5f94d6/vitest-report.json', sha256: 'b75e74136525' },
    { path: 'first100-evidence-8d5f94d6/vitest-report.json', sha256: 'bb9ab2d84262' },
  ]

  it('picks the artifact whose bytes match, not the one listed first', () => {
    expect(selectArtifactByDigest(candidates, 'bb9ab2d84262')).toBe('first100-evidence-8d5f94d6/vitest-report.json')
  })

  it('picks by digest even when the naming convention would mislead', () => {
    expect(selectArtifactByDigest(candidates, 'b75e74136525')).toBe('first100-vitest-report-8d5f94d6/vitest-report.json')
  })

  it('returns null rather than a best guess when nothing matches, so a caller cannot report a sound cell as MISMATCHED', () => {
    expect(selectArtifactByDigest(candidates, 'ffffffffffff')).toBeNull()
  })

  it('returns null for an empty candidate list', () => {
    expect(selectArtifactByDigest([], 'bb9ab2d84262')).toBeNull()
  })
})

describe('recomputeMatchedCases (BLOCKED-106, 2026-09-06)', () => {
  it('confirms only the frozen cases the observation shows passing', () => {
    const passing = new Set(['alpha', 'gamma'])
    expect(recomputeMatchedCases(['alpha', 'beta', 'gamma'], passing)).toStrictEqual({
      matched: ['alpha', 'gamma'],
      unmatched: ['beta'],
    })
  })

  it('confirms nothing when the observation shows nothing passing', () => {
    expect(recomputeMatchedCases(['alpha'], new Set())).toStrictEqual({ matched: [], unmatched: ['alpha'] })
  })

  it('ignores passing cases the freeze does not name, so an unrelated suite cannot pad a cell', () => {
    expect(recomputeMatchedCases(['alpha'], new Set(['alpha', 'an unrelated epic\'s case']))).toStrictEqual({
      matched: ['alpha'],
      unmatched: [],
    })
  })
})

describe('rescuedArtifactPaths', () => {
  const RUN = 'https://github.com/owner/repo/actions/runs/33596937698'

  /** A rescued artifact tree: one run directory holding the named upload directories. */
  function rescued(uploads: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'first100-artifacts-'))
    for (const upload of uploads) {
      mkdirSync(join(root, '33596937698', upload), { recursive: true })
      writeFileSync(join(root, '33596937698', upload, 'vitest-report.json'), '{}', 'utf8')
    }
    return root
  }

  it('finds both uploads a run made, so the digest has something to choose between', () => {
    const root = rescued(['first100-vitest-report-abc', 'first100-evidence-abc'])
    expect(rescuedArtifactPaths(RUN, root)).toStrictEqual([
      join(root, '33596937698', 'first100-evidence-abc', 'vitest-report.json'),
      join(root, '33596937698', 'first100-vitest-report-abc', 'vitest-report.json'),
    ])
  })

  it('enumerates what is on disk rather than composing the directory name from the cell', () => {
    // The point of reading the directory: a rescued upload whose name disagrees
    // with the cell's own sha is still found, and it is the DIGEST that then
    // decides. Composing `first100-evidence-<candidateSha>` would skip it and
    // report the cell unprovable for a filename.
    const root = rescued(['first100-evidence-a-sha-nobody-expected'])
    expect(rescuedArtifactPaths(RUN, root)).toHaveLength(1)
  })

  it('returns nothing when the deployment keeps no rescued artifacts, which is the normal state', () => {
    expect(rescuedArtifactPaths(RUN, undefined)).toStrictEqual([])
    expect(rescuedArtifactPaths(RUN, '')).toStrictEqual([])
  })

  it('returns nothing for a run it has no directory for, rather than reaching into a sibling run', () => {
    const root = rescued(['first100-evidence-abc'])
    expect(rescuedArtifactPaths('https://github.com/owner/repo/actions/runs/99999999999', root)).toStrictEqual([])
  })

  it('refuses a ciRunUrl whose last segment is not a run id, so a malformed URL cannot name a directory', () => {
    const root = rescued(['first100-evidence-abc'])
    expect(rescuedArtifactPaths('https://github.com/owner/repo/actions', root)).toStrictEqual([])
    expect(rescuedArtifactPaths('', root)).toStrictEqual([])
    expect(rescuedArtifactPaths(undefined, root)).toStrictEqual([])
  })

  it('finds a report rescued to the top of the run directory, and STILL refuses it when the digest disagrees', () => {
    // Two of the fifty rescued run directories on the delegate machine hold the
    // report at the top rather than under an upload-named directory. Finding it
    // is half the case: the other half is that looking in one more place must
    // not widen what the gate ACCEPTS, so the same file is then offered to the
    // digest with a sha256 that does not match and has to be refused.
    const root = mkdtempSync(join(tmpdir(), 'first100-artifacts-top-'))
    mkdirSync(join(root, '33596937698'), { recursive: true })
    const top = join(root, '33596937698', 'vitest-report.json')
    writeFileSync(top, '{}', 'utf8')

    expect(rescuedArtifactPaths(RUN, root)).toStrictEqual([top])
    const candidates = [{ path: top, sha256: 'the-digest-this-file-actually-has' }]
    expect(selectArtifactByDigest(candidates, 'the-digest-the-cell-recorded')).toBeNull()
    expect(selectArtifactByDigest(candidates, 'the-digest-this-file-actually-has')).toBe(top)
  })
})

describe('liveFreezeByStage', () => {
  const primary = { epic: 'P4-12', stage: 'C', expectCases: ['a'], supersededBy: 'P4-12.C.3' }
  const supplement = { epic: 'P4-12', stage: 'C', supplementSeq: 3, expectCases: ['b'] }

  it('keeps a stage whose primary was superseded but whose supplement is live', () => {
    // The defect this replaces: supplements were skipped outright, so a stage in
    // exactly this state looked to the gate like it had no freeze at all, and
    // its cells were reported UNAVAILABLE with a remedy -- re-download the
    // artifact -- that could never apply, the artifact being present already.
    expect(liveFreezeByStage([primary, supplement]).get('P4-12|C')).toStrictEqual([supplement])
  })

  it('collects a live primary and its live supplements together, so neither alone is the stage', () => {
    const live = { epic: 'P1-03', stage: 'U', expectCases: ['a'] }
    const supp = { epic: 'P1-03', stage: 'U', supplementSeq: 1, expectCases: ['b'] }
    expect(liveFreezeByStage([live, supp]).get('P1-03|U')).toStrictEqual([live, supp])
  })

  it('drops a stage whose every entry is superseded, rather than reporting a stale one as live', () => {
    expect(liveFreezeByStage([primary]).has('P4-12|C')).toBe(false)
  })
})

describe('partitionFindings', () => {
  const falsifying = { field: 'expectCasesMatched', problem: 'recorded but not passing', detail: [] }
  const drifting = { field: 'frozenCasesNotInObservation', problem: 'freeze moved', detail: [] }

  it('calls only a recorded-but-not-passing case a falsification, so a supersession does not read as tampering', () => {
    expect(partitionFindings([falsifying, drifting])).toStrictEqual({ falsified: [falsifying], drifted: [drifting] })
  })

  it('treats both drift fields alike, since each is repaired by regreening rather than by correcting the cell', () => {
    const notRecorded = { field: 'frozenCasesNotRecorded', problem: 'freeze names more', detail: [] }
    expect(partitionFindings([drifting, notRecorded]).falsified).toStrictEqual([])
  })

  it('reports neither for a cell that recomputes exactly', () => {
    expect(partitionFindings([])).toStrictEqual({ falsified: [], drifted: [] })
  })
})

describe('checkCellAgainstObservation compares each case with the record that holds it (drift by origin, 2026-09-15)', () => {
  // Six controls from lane A's drift-fixtures.mjs. cmdGreen records only the
  // primary entry's cases on the cell and cmdSupplement writes row.supplements,
  // so a supplement case is judged against its supplement record, never the cell.
  const P = 'primary case one'
  const Q = 'primary case two'
  const S1 = 'supplement case one'
  const S2 = 'supplement case two'
  const report = (passing: string[]) => ({
    testResults: [{ name: '/x/tests/fixture.spec.ts', assertionResults: passing.map(fullName => ({ fullName, status: 'passed' })) }],
  })
  const entry = (cases: string[], extra: Record<string, unknown> = {}) => ({ epic: 'E', stage: 'P', expectCases: cases, expectExit: 0, ...extra })
  const supplement = (seq: number, cases: string[]) => entry(cases, { supplementSeq: seq, supplements: { epic: 'E', stage: 'P' } })

  /** Judge a cell the way the gate does: live entries, split by origin, then compared. */
  function judge(
    entries: ReturnType<typeof entry>[],
    cell: { expectCasesMatched: string[] },
    supplements: Record<string, unknown>,
    passing: string[],
  ) {
    const live = liveFreezeByStage(entries).get('E|P') ?? []
    return { live, findings: checkCellAgainstObservation(cell, frozenCasesByOrigin('E', 'P', live), report(passing), { supplements }) }
  }

  it('does not hold the cell to a live supplement case that is passing in its observation', () => {
    const { findings } = judge([entry([P, Q]), supplement(3, [S1])], { expectCasesMatched: [P, Q] }, { 'P.3': { expectCasesMatched: [S1] } }, [P, Q, S1])
    expect(findings).toStrictEqual([])
  })

  it('does not ask the cell\'s observation for a supplement case, which a different run observes', () => {
    const { findings } = judge([entry([P, Q]), supplement(3, [S1])], { expectCasesMatched: [P, Q] }, { 'P.3': { expectCasesMatched: [S1] } }, [P, Q])
    expect(findings).toStrictEqual([])
  })

  it('still resolves a stage whose primary was superseded and whose supplement is live', () => {
    const { live, findings } = judge([entry([P], { supersededBy: 'later' }), supplement(3, [S1])], { expectCasesMatched: [] }, { 'P.3': { expectCasesMatched: [S1] } }, [S1])
    expect(live).toHaveLength(1)
    expect(findings).toStrictEqual([])
  })

  it('still reports a primary case the observation confirms and the cell does not record', () => {
    const { findings } = judge([entry([P, Q])], { expectCasesMatched: [P] }, {}, [P, Q])
    expect(findings.map(f => [f.field, f.detail])).toStrictEqual([['frozenCasesNotRecorded', [Q]]])
  })

  it('names a frozen supplement with no ledger record as never greened, not as drift in the cell', () => {
    const { findings } = judge([entry([P]), supplement(4, [S2])], { expectCasesMatched: [P] }, {}, [P, S2])
    expect(findings.map(f => [f.field, f.detail])).toStrictEqual([['supplementNotRecorded', [S2]]])
    expect(findings[0]?.problem).toContain('supplement P.4')
  })

  it('attributes a case missing from a supplement\'s own record to that supplement, and only that case', () => {
    const { findings } = judge([entry([P]), supplement(3, [S1, S2])], { expectCasesMatched: [P] }, { 'P.3': { expectCasesMatched: [S1] } }, [P, S1, S2])
    expect(findings.map(f => [f.field, f.detail])).toStrictEqual([['frozenCasesNotRecorded', [S2]]])
    expect(findings[0]?.problem).toContain('supplement P.3')
  })

  it('keeps a title a supplement restates from the primary as a primary case, keyed to no supplement', () => {
    const frozen = frozenCasesByOrigin('E', 'P', [entry([P, Q]), supplement(1, [Q, S1])])
    expect([...frozen.primaryCases]).toStrictEqual([P, Q])
    expect([...frozen.supplementCases]).toStrictEqual([[S1, 'P.1']])
    expect(frozen.expectCases).toStrictEqual([P, Q, S1])
  })

  it('files a never-greened supplement under drift, not falsification', () => {
    const { findings } = judge([entry([P]), supplement(4, [S2])], { expectCasesMatched: [P] }, {}, [P, S2])
    expect(partitionFindings(findings)).toStrictEqual({ falsified: [], drifted: findings })
  })
})
