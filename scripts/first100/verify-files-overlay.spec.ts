/**
 * §12.4's overlay: what it classifies, what it covers, and what it refuses.
 *
 * The cases that matter are the refusals. An overlay derived from the same
 * freeze entries it is checked against is trivially complete, so the coverage
 * case proves almost nothing on its own; the reason gate and the classifier's
 * `source` boundary are where this can actually fail.
 */

import { describe, expect, it } from 'vitest'
import { classifyOverlayPath, computeOverlay, declaredPaths } from './files-overlay.mjs'
import { hotZoneEntriesWithoutCitation, sourceEntriesWithoutReason, unaccountedCitations } from './verify-files-overlay.mjs'

const registry = {
  epics: [{
    id: 'P9-99',
    files: [{ path: 'packages/demo/thing/src/declared.ts' }],
    stages: { C: { files: ['packages/demo/thing/tests/declared.spec.ts'] } },
  }],
}

const freeze = (files: string[], extra: Record<string, unknown> = {}) => [{
  epic: 'P9-99', stage: 'U', files, ...extra,
}]

describe('classifyOverlayPath', () => {
  it('classifies by role, not by directory depth', () => {
    expect(classifyOverlayPath('packages/a/b/tests/x.spec.ts')).toBe('test')
    expect(classifyOverlayPath('packages/a/b/src/x.spec.ts')).toBe('test')
    expect(classifyOverlayPath('snapshots/session/x/session.jsonl')).toBe('fixture')
    expect(classifyOverlayPath('packages/a/b/README.md')).toBe('doc')
    expect(classifyOverlayPath('packages/a/b/package.json')).toBe('manifest')
    expect(classifyOverlayPath('packages/a/b/src/thing.ts')).toBe('source')
    expect(classifyOverlayPath('scripts/gen-thing.ts')).toBe('source')
  })

  it('calls a package barrel SOURCE, because scaffold is an admission and not a filename', () => {
    // A first draft returned `scaffold` for every `src/index.ts`, which would
    // have classified `core/session/src/index.ts` and `core/agent/src/index.ts`
    // — the hot-zone files §12.4 sends to the delegate — as convention-forced
    // barrels needing no explanation.
    expect(classifyOverlayPath('packages/core/session/src/index.ts')).toBe('source')
    expect(classifyOverlayPath('packages/collaboration/intake-dedup/src/index.ts')).toBe('source')
  })
})

describe('computeOverlay', () => {
  it('records only what the declaration does not already cover', () => {
    const overlay = computeOverlay(registry, freeze([
      'packages/demo/thing/src/declared.ts',
      'packages/demo/thing/src/undeclared.ts',
    ]), {})
    expect(overlay.map(entry => entry.path)).toEqual(['packages/demo/thing/src/undeclared.ts'])
  })

  it('reads a stage file list as declared too, so a stage-only path is not recorded twice', () => {
    expect(declaredPaths(registry.epics[0]!).has('packages/demo/thing/tests/declared.spec.ts')).toBe(true)
    expect(computeOverlay(registry, freeze(['packages/demo/thing/tests/declared.spec.ts']), {})).toEqual([])
  })

  it('EXCLUDES a superseded entry, so replaced work does not widen the scope', () => {
    // Without this, every path a superseded freeze ever named would stay in
    // scope forever, and the overlay would grow monotonically with abandoned
    // shapes.
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/gone.ts'], { supersededBy: 'P9-99.U.2' }), {})
    expect(overlay).toEqual([])
  })

  it('merges the stages that cite one path instead of repeating the path', () => {
    const entries = [
      { epic: 'P9-99', stage: 'U', files: ['packages/demo/thing/src/x.ts'] },
      { epic: 'P9-99', stage: 'F', supplementSeq: 2, files: ['packages/demo/thing/src/x.ts'] },
    ]
    const overlay = computeOverlay(registry, entries, {})
    expect(overlay).toHaveLength(1)
    expect(overlay[0]?.stages).toEqual(['U', 'F.2'])
  })

  it('ignores an epic the registry does not have, rather than inventing a row for it', () => {
    expect(computeOverlay(registry, [{ epic: 'P9-98', stage: 'U', files: ['a.ts'] }], {})).toEqual([])
  })
})

describe('the coverage and reason refusals', () => {
  it('refuses a source path with no reason, and names it', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/undeclared.ts']), {})
    expect(sourceEntriesWithoutReason(overlay).map(entry => entry.path)).toEqual(['packages/demo/thing/src/undeclared.ts'])
  })

  it('accepts it once a reason exists, so the refusal is about the reason and not the path', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/undeclared.ts']), {
      'P9-99 packages/demo/thing/src/undeclared.ts': 'the seam the clause is about',
    })
    expect(sourceEntriesWithoutReason(overlay)).toEqual([])
  })

  it('treats a blank reason as no reason, so the field cannot be satisfied with whitespace', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/undeclared.ts']), {
      'P9-99 packages/demo/thing/src/undeclared.ts': '   ',
    })
    expect(sourceEntriesWithoutReason(overlay)).toHaveLength(1)
  })

  it('does NOT require a reason for a test, doc, fixture or manifest path', () => {
    // The declaration is a sketch of principal deliverables, so those landing
    // outside it is ordinary. Product code the plan never named is not.
    const overlay = computeOverlay(registry, freeze([
      'packages/demo/thing/tests/extra.spec.ts',
      'packages/demo/thing/README.md',
      'packages/demo/thing/package.json',
    ]), {})
    expect(overlay).toHaveLength(3)
    expect(sourceEntriesWithoutReason(overlay)).toEqual([])
  })

  it('reports a citation covered by neither the declaration nor the overlay', () => {
    // Empty by construction while the overlay is derived from these same
    // entries; it stops being empty the moment the overlay is pinned to a
    // committed file, which is when a reader needs to hear about it.
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/undeclared.ts']), {})
    expect(unaccountedCitations(registry, freeze(['packages/demo/thing/src/undeclared.ts']), overlay)).toEqual([])
    expect(unaccountedCitations(registry, freeze(['packages/demo/thing/src/other.ts']), overlay))
      .toEqual([{ epic: 'P9-99', stage: 'U', path: 'packages/demo/thing/src/other.ts' }])
  })
})

describe('hotZoneEntriesWithoutCitation', () => {
  const hotZone = (reason: string) => computeOverlay(registry, freeze(['packages/demo/thing/src/shared.ts']), {
    'P9-99 packages/demo/thing/src/shared.ts': reason,
  })

  it('refuses a HOT ZONE reason that cites no diff', () => {
    // Three of the first five hot-zone reasons described the epic's intent
    // rather than its change, all three calling a modification of a shared
    // file a read of it. A gate cannot tell whether a sentence is true; it can
    // require the sentence to name the diff a reviewer checks it against.
    expect(hotZoneEntriesWithoutCitation(hotZone('HOT ZONE: this epic only reads the file.'))).toHaveLength(1)
  })

  it('accepts one that names a commit, in the form a reader can re-run', () => {
    expect(hotZoneEntriesWithoutCitation(hotZone('HOT ZONE. From `git show 05c22146ef -- packages/demo/thing/src/shared.ts`: the constructor gained a parameter.'))).toEqual([])
  })

  it('leaves a non-hot-zone reason alone, so ordinary source entries are not forced to cite a diff', () => {
    expect(hotZoneEntriesWithoutCitation(hotZone('The seam the clause is about.'))).toEqual([])
  })

  it('accepts a reason that NAMES the label while explaining it does not apply', () => {
    // Found by the gate refusing its own author: a reason reading "NOT
    // labelled HOT ZONE: this file is not on §2.D's list" was rejected for
    // citing no sha, and satisfying the check would have meant deleting the
    // sentence that explains the classification. Anchored for the same reason
    // `verify-adapt-dispositions` anchors its read-only label.
    expect(hotZoneEntriesWithoutCitation(hotZone('Two additions to a union. NOT labelled HOT ZONE: this file is not on the list.'))).toEqual([])
  })
})
