/**
 * Which freeze entries the in-tree gate actually reads (BLOCKED-226).
 *
 * The gate selected one entry per `epic.stage`, so a cell carrying both a base
 * entry and a supplement had the base entry's titles read by nothing. These
 * cases pin the selection rule, because that is where the defect was: the
 * title comparison was always correct, and it was simply not reached.
 *
 * `findOrphans` is driven directly rather than through the gate's process. The
 * gate's other half runs `vitest list` over the whole repository, which takes
 * minutes and would make these cases measure collection rather than selection.
 */
import { describe, expect, it } from 'vitest'
import { findOrphans } from './verify-frozen-titles-in-tree.mjs'
import type { InTreeFreezeEntry } from './verify-frozen-titles-in-tree.d.mts'

const entry = (over: Partial<InTreeFreezeEntry> = {}): InTreeFreezeEntry =>
  ({ epic: 'P4-12', stage: 'C', expectCases: ['a case that exists'], ...over })

const noRenames = new Map<string, string>()

describe('BLOCKED-226: every live entry is checked, not the last one per cell', () => {
  it('reports the BASE entry\'s vanished title when a live supplement exists for the same cell', () => {
    // The measured defect. Keying by `epic.stage` let the supplement overwrite
    // the base, so this orphan was invisible and the cell reported clean.
    const orphans = findOrphans(
      [entry({ expectCases: ['a title no test produces'] }), entry({ supplementSeq: 2, expectCases: ['a case that exists'] })],
      new Set(['a case that exists']),
      noRenames,
    )
    expect(orphans).toEqual([{ key: 'P4-12.C', title: 'a title no test produces' }])
  })

  it('reports a SUPPLEMENT\'s vanished title under its own sequence, so the reader knows which entry to supersede', () => {
    // `P4-12.C` and `P4-12.C.2` are different promises. A label that named only
    // the cell would send a reader to supersede the wrong entry.
    const orphans = findOrphans(
      [entry(), entry({ supplementSeq: 2, expectCases: ['a supplement title that is gone'] })],
      new Set(['a case that exists']),
      noRenames,
    )
    expect(orphans).toEqual([{ key: 'P4-12.C.2', title: 'a supplement title that is gone' }])
  })

  it('ignores a SUPERSEDED entry, because it describes a past state on purpose', () => {
    // The control that keeps the rule above from becoming "check everything
    // ever frozen": superseding an entry is how a replaced case is recorded,
    // and re-reporting it would make the correct procedure fail the gate.
    expect(findOrphans(
      [entry({ expectCases: ['a title no test produces'], supersededBy: 'P4-12.C.3 (2026-09-12)' })],
      new Set(['a case that exists']),
      noRenames,
    )).toEqual([])
  })

  it('reports every orphan across two live entries for one cell, rather than stopping at the first', () => {
    const orphans = findOrphans(
      [entry({ expectCases: ['gone from the base'] }), entry({ supplementSeq: 1, expectCases: ['gone from the supplement'] })],
      new Set(['a case that exists']),
      noRenames,
    )
    expect(orphans.map(orphan => orphan.key)).toEqual(['P4-12.C', 'P4-12.C.1'])
  })

  it('resolves a title through the rename registered for its own cell', () => {
    // The gate's existing contract, asserted here because the selection change
    // moved the code that consults the register.
    expect(findOrphans(
      [entry({ expectCases: ['the old title'] })],
      new Set(['the new title']),
      new Map([['P4-12|C|the old title', 'the new title']]),
    )).toEqual([])
  })
})
