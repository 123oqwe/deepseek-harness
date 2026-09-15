/**
 * §12.4's overlay: what it classifies, what it covers, and what it refuses.
 *
 * The cases that matter are the refusals. An overlay derived from the same
 * freeze entries it is checked against is trivially complete, so the coverage
 * case proves almost nothing on its own; the reason gate and the classifier's
 * `source` boundary are where this can actually fail.
 */

import { describe, expect, it } from 'vitest'
import { classifyOverlayPath, computeOverlay, declaredPaths, declaredPathsAsExtracted, patchEntries, resolveDeclaredPaths } from './files-overlay.mjs'
import { compareCommittedOverlay, hotZoneEntriesWithoutCitation, overlayFileText, sourceEntriesWithoutReason, unaccountedCitations, unusedReasonKeys } from './verify-files-overlay.mjs'

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
    ]), {}, [])
    expect(overlay.map(entry => entry.path)).toEqual(['packages/demo/thing/src/undeclared.ts'])
  })

  it('reads a stage file list as declared too, so a stage-only path is not recorded twice', () => {
    expect(declaredPaths(registry.epics[0]!, []).has('packages/demo/thing/tests/declared.spec.ts')).toBe(true)
    expect(computeOverlay(registry, freeze(['packages/demo/thing/tests/declared.spec.ts']), {}, [])).toEqual([])
  })

  it('EXCLUDES a superseded entry, so replaced work does not widen the scope', () => {
    // Without this, every path a superseded freeze ever named would stay in
    // scope forever, and the overlay would grow monotonically with abandoned
    // shapes.
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/gone.ts'], { supersededBy: 'P9-99.U.2' }), {}, [])
    expect(overlay).toEqual([])
  })

  it('merges the stages that cite one path instead of repeating the path', () => {
    const entries = [
      { epic: 'P9-99', stage: 'U', files: ['packages/demo/thing/src/x.ts'] },
      { epic: 'P9-99', stage: 'F', supplementSeq: 2, files: ['packages/demo/thing/src/x.ts'] },
    ]
    const overlay = computeOverlay(registry, entries, {}, [])
    expect(overlay).toHaveLength(1)
    expect(overlay[0]?.stages).toEqual(['U', 'F.2'])
  })

  it('ignores an epic the registry does not have, rather than inventing a row for it', () => {
    expect(computeOverlay(registry, [{ epic: 'P9-98', stage: 'U', files: ['a.ts'] }], {}, [])).toEqual([])
  })
})

describe('the coverage and reason refusals', () => {
  it('refuses a source path with no reason, and names it', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/undeclared.ts']), {}, [])
    expect(sourceEntriesWithoutReason(overlay).map(entry => entry.path)).toEqual(['packages/demo/thing/src/undeclared.ts'])
  })

  it('accepts it once a reason exists, so the refusal is about the reason and not the path', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/undeclared.ts']), {
      'P9-99 packages/demo/thing/src/undeclared.ts': 'the seam the clause is about',
    }, [])
    expect(sourceEntriesWithoutReason(overlay)).toEqual([])
  })

  it('treats a blank reason as no reason, so the field cannot be satisfied with whitespace', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/undeclared.ts']), {
      'P9-99 packages/demo/thing/src/undeclared.ts': '   ',
    }, [])
    expect(sourceEntriesWithoutReason(overlay)).toHaveLength(1)
  })

  it('does NOT require a reason for a test, doc, fixture or manifest path', () => {
    // The declaration is a sketch of principal deliverables, so those landing
    // outside it is ordinary. Product code the plan never named is not.
    const overlay = computeOverlay(registry, freeze([
      'packages/demo/thing/tests/extra.spec.ts',
      'packages/demo/thing/README.md',
      'packages/demo/thing/package.json',
    ]), {}, [])
    expect(overlay).toHaveLength(3)
    expect(sourceEntriesWithoutReason(overlay)).toEqual([])
  })

  it('reports a citation covered by neither the declaration nor the overlay', () => {
    // Empty by construction while the overlay is derived from these same
    // entries; it stops being empty the moment the overlay is pinned to a
    // committed file, which is when a reader needs to hear about it.
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/undeclared.ts']), {}, [])
    expect(unaccountedCitations(registry, freeze(['packages/demo/thing/src/undeclared.ts']), overlay, [])).toEqual([])
    expect(unaccountedCitations(registry, freeze(['packages/demo/thing/src/other.ts']), overlay, []))
      .toEqual([{ epic: 'P9-99', stage: 'U', path: 'packages/demo/thing/src/other.ts' }])
  })
})

describe('hotZoneEntriesWithoutCitation', () => {
  const hotZone = (reason: string) => computeOverlay(registry, freeze(['packages/demo/thing/src/shared.ts']), {
    'P9-99 packages/demo/thing/src/shared.ts': reason,
  }, [])

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

describe('unusedReasonKeys', () => {
  const moved = 'P9-99 packages/demo/thing/src/old-home.ts'
  const current = 'P9-99 packages/demo/thing/src/extra.ts'
  const reasons = { [current]: 'Why the extra file is in scope.', [moved]: 'Why the file was in scope before it moved.' }

  it('lists a reason whose path no live freeze entry cites any more', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/extra.ts']), reasons, [])
    expect(unusedReasonKeys(overlay, reasons)).toEqual([moved])
  })

  it('lists nothing when every reason is used, so the listing is about disuse and not about reasons existing', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/extra.ts', 'packages/demo/thing/src/old-home.ts']), reasons, [])
    expect(unusedReasonKeys(overlay, reasons)).toEqual([])
  })

  it('does not turn an unused reason into a refusal', () => {
    const overlay = computeOverlay(registry, freeze(['packages/demo/thing/src/extra.ts']), reasons, [])
    expect(sourceEntriesWithoutReason(overlay)).toEqual([])
    expect(unaccountedCitations(registry, freeze(['packages/demo/thing/src/extra.ts']), overlay, [])).toEqual([])
  })
})

describe('compareCommittedOverlay', () => {
  const reasons = { 'P9-99 packages/demo/thing/src/extra.ts': 'Why the extra file is in scope.' }
  const cited = ['packages/demo/thing/src/extra.ts', 'packages/demo/thing/tests/extra.spec.ts']
  const overlay = computeOverlay(registry, freeze(cited), reasons, [])

  it('matches the file --write produces, and the same document with other whitespace', () => {
    expect(compareCommittedOverlay(overlayFileText(overlay), overlay)).toStrictEqual({ status: 'match' })
    expect(compareCommittedOverlay(JSON.stringify(JSON.parse(overlayFileText(overlay))), overlay)).toStrictEqual({ status: 'match' })
  })

  it('names the entries a stale file still holds and the entries it lacks, in both directions', () => {
    const holdsExtra = overlayFileText(computeOverlay(registry, freeze([...cited, 'docs/extra.md']), reasons, []))
    expect(compareCommittedOverlay(holdsExtra, overlay)).toStrictEqual({ status: 'drift', onlyCommitted: ['P9-99 docs/extra.md'], onlyComputed: [] })
    const lacksOne = overlayFileText(computeOverlay(registry, freeze(['packages/demo/thing/src/extra.ts']), reasons, []))
    expect(compareCommittedOverlay(lacksOne, overlay)).toStrictEqual({ status: 'drift', onlyCommitted: [], onlyComputed: ['P9-99 packages/demo/thing/tests/extra.spec.ts'] })
  })

  it('reports drift when every (epic, path) matches but an entry field differs', () => {
    const changed = JSON.parse(overlayFileText(overlay)) as { entries: { stages: string[] }[] }
    changed.entries[0]!.stages = ['F']
    expect(compareCommittedOverlay(JSON.stringify(changed), overlay)).toStrictEqual({ status: 'drift', onlyCommitted: [], onlyComputed: [] })
  })

  it('cannot compare a file that is unreadable, not JSON, or empty, and never reads one as a match', () => {
    expect(compareCommittedOverlay(undefined, overlay)).toStrictEqual({ status: 'uncomparable', reason: 'the file cannot be read' })
    expect(compareCommittedOverlay('{', overlay)).toStrictEqual({ status: 'uncomparable', reason: 'the file is not JSON' })
    expect(compareCommittedOverlay(overlayFileText([]), overlay)).toStrictEqual({ status: 'uncomparable', reason: 'the file holds no entries' })
  })
})

describe('declared paths through the deliverable-path patches, the one resolution the overlay, the reality set and the declared-files gate share', () => {
  const declared = 'packages/demo/thing/tests/declared.spec.ts'
  const approved = 'packages/demo/thing/tests/declared.e2e.spec.ts'
  const patch = (fields: { stage?: string; approvedPath?: string; kind?: 'widening' | 'substitution' }) => ({ epic: 'P9-99', stage: 'C', declaredPath: declared, approvedPath: approved, kind: 'substitution' as const, ...fields })

  it('reads a patch entry without an epic field under its own key, as generate-specs does', () => {
    const adjudication = { deliverablePathPatches: { entries: { 'P9-99': { stage: 'C', declaredPath: 'a.ts', approvedPath: 'b.ts', kind: 'substitution' as const } } } }
    expect(patchEntries(adjudication)).toStrictEqual([{ stage: 'C', declaredPath: 'a.ts', approvedPath: 'b.ts', kind: 'substitution', epic: 'P9-99' }])
  })

  it('refuses an approvedPath that carries whitespace or an anchor, naming the entry', () => {
    const entry = (approvedPath: string) => ({ deliverablePathPatches: { entries: { 'P9-99-C-bad': { epic: 'P9-99', stage: 'C', declaredPath: declared, approvedPath, kind: 'substitution' as const } } } })
    expect(() => patchEntries(entry('packages/demo/a.ts + docs/b.md'))).toThrow('P9-99-C-bad')
    expect(() => patchEntries(entry('docs/glossary.md#capability-seam'))).toThrow('no whitespace or # anchor')
    expect(patchEntries(entry('docs/glossary.md')).map(patch => patch.approvedPath)).toStrictEqual(['docs/glossary.md'])
  })

  it('refuses a patch entry whose kind is missing or misspelt, naming the entry', () => {
    const entry = (fields: Record<string, string>) => ({ deliverablePathPatches: { entries: { 'P9-99-C-kind': { epic: 'P9-99', stage: 'C', declaredPath: declared, approvedPath: approved, ...fields } } } }) as unknown as Parameters<typeof patchEntries>[0]
    expect(() => patchEntries(entry({}))).toThrow('P9-99-C-kind')
    expect(() => patchEntries(entry({ Kind: 'widening' }))).toThrow('must be "widening" or "substitution"')
    expect(() => patchEntries(entry({ kind: 'widen' }))).toThrow('"widen"')
    expect(patchEntries(entry({ kind: 'widening' })).map(p => p.kind)).toStrictEqual(['widening'])
  })

  it('resolves a stage declaration through every patch for that stage, and not through a patch for another stage', () => {
    const second = 'packages/demo/thing/tests/second.spec.ts'
    const records = resolveDeclaredPaths(registry.epics[0]!, [patch({}), patch({ approvedPath: second }), patch({ stage: 'U', approvedPath: 'packages/demo/thing/tests/other.spec.ts' })])
    expect(records.find(record => record.where === 'P9-99.C')).toStrictEqual({ where: 'P9-99.C', declaredPath: declared, approvedPaths: [approved, second], widening: false })
  })

  it('keeps the declared path beside the approved one, so a freeze entry that still cites it stays declared', () => {
    expect(declaredPaths(registry.epics[0]!, [patch({})]).has(declared)).toBe(true)
    expect(declaredPaths(registry.epics[0]!, [patch({})]).has(approved)).toBe(true)
    expect(declaredPathsAsExtracted(registry.epics[0]!).has(approved)).toBe(false)
  })

  it('records no overlay entry for a frozen path a patch approves, nor for the declared path it substitutes for', () => {
    const cited = freeze([approved, declared])
    expect(computeOverlay(registry, cited, {}, [patch({})])).toEqual([])
    expect(computeOverlay(registry, cited, {}, []).map(entry => entry.path)).toEqual([approved])
  })
})
