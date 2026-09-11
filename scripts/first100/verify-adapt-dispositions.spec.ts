/**
 * Gate (e)'s standards rule: what counts as claiming an assigned vocabulary.
 *
 * The rule changed in §12.85 note 47. Ownership assigned by the plan means
 * "if this vocabulary appears in the tree, this epic is answerable for it" —
 * it is not an obligation to adopt. So an epic claims an assigned standard
 * either by adopting it and freezing a case that names it, or by MEASURING
 * that the implementation took another route and recording that measurement
 * in `deviations[]`. The cases that matter here are the boundary between a
 * measured non-adoption and silence, because collapsing those two is what the
 * whole gate exists to prevent.
 */

import { describe, expect, it } from 'vitest'
import { standardDispositionGaps } from './verify-adapt-dispositions.mjs'

const ATLAS = 'MITRE ATLAS technique ids'
const assignedAtlas = [{ standard: ATLAS, thisEpicOwns: true }]

describe('standardDispositionGaps — an assigned standard is claimed two ways', () => {
  it('passes an assigned standard that the record OWNS', () => {
    expect(standardDispositionGaps([ATLAS], { standardsOwned: [{ standard: ATLAS }] }, assignedAtlas)).toEqual([])
  })

  it('passes an assigned standard the record DEVIATES from with a measurement (note 47)', () => {
    const declared = { standardsOwned: [], deviations: [{ standard: ATLAS, reason: 'whole-tree census returns zero hits' }] }
    expect(standardDispositionGaps([ATLAS], declared, assignedAtlas)).toEqual([])
  })

  it('REFUSES an assigned standard that appears in neither list, naming both places it could be claimed', () => {
    const gaps = standardDispositionGaps([], { standardsOwned: [] }, assignedAtlas)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toContain('neither standardsOwned nor deviations claims it')
  })

  it('reads a bare string as well as the object form, in both lists', () => {
    // The object form carries the evidence substring or the deviation's
    // reason; the bare form is the older spelling and both are live in the
    // records this gate reads.
    expect(standardDispositionGaps([ATLAS], { standardsOwned: [ATLAS] }, assignedAtlas)).toEqual([])
    expect(standardDispositionGaps([ATLAS], { standardsImported: [ATLAS] }, [])).toEqual([])
    expect(standardDispositionGaps([ATLAS], { standardsImported: [{ standard: ATLAS, from: 'P1-01' }] }, [])).toEqual([])
  })

  it('does not let an IMPORT claim an ASSIGNED ownership, which is a different statement', () => {
    // Importing says another epic fixes the vocabulary. The table says THIS
    // epic is answerable for it, so an import leaves the assignment unclaimed
    // and the carded standard disposed — one message, not two.
    const gaps = standardDispositionGaps([ATLAS], { standardsImported: [ATLAS] }, assignedAtlas)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toContain('neither standardsOwned nor deviations claims it')
  })

  it('does NOT accept a standard recorded under `name`, the adapt-shaped key', () => {
    // `name` + `npm` marks an adapt package; `standard` marks a standard. The
    // two keys are two kinds of subject, not two spellings of one — 57 adapt
    // rows and 22 standard rows across the records, and no row mixes them. A
    // standard written under `name` is a malformed record, and absorbing it
    // here would let an adapt row silently discharge a standard's disposition.
    const declared = { standardsOwned: [], deviations: [{ name: ATLAS, reason: 'census returns zero hits' }] }
    const gaps = standardDispositionGaps([ATLAS], declared, assignedAtlas)
    expect(gaps).toHaveLength(2)
    expect(gaps[0]).toContain('is neither owned, imported, nor deviated')
    expect(gaps[1]).toContain('neither standardsOwned nor deviations claims it')
  })

  it('ignores a row the table does not mark as owned by this epic', () => {
    expect(standardDispositionGaps([], { standardsOwned: [] }, [{ standard: ATLAS, thisEpicOwns: false }])).toEqual([])
  })
})
