/**
 * Unit coverage for the BLOCKED-106 recomputation gate's pure decisions.
 *
 * The gate's value is that it re-derives a cell's contents from the artifact
 * instead of inspecting how the fields look, so these cases pin the two
 * decisions that carry that: which file counts as the artifact, and which
 * frozen cases the artifact actually confirms.
 */
import { describe, expect, it } from 'vitest'

import { recomputeMatchedCases, selectArtifactByDigest } from './verify-cells-recomputable.mjs'

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
