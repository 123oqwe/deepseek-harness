/**
 * Gate (u): a Usage stage must touch the consumer the registry names.
 *
 * The cases that matter are the two boundaries — what counts as a subject, and
 * what an exemption must carry. A gate whose exemption accepts anything is a
 * gate with an off switch.
 */

import { describe, expect, it } from 'vitest'
import { usageBaselineFiles, usageEntriesWithoutSubject } from './verify-usage-stage-subject.mjs'

const registry = {
  epics: [{
    id: 'P9-99',
    files: [
      { path: 'packages/host/consumer/src/index.ts', kind: 'B' },
      { path: 'packages/demo/thing/src/index.ts', kind: 'N' },
    ],
    stages: { U: { files: ['packages/host/consumer/src/index.ts', 'packages/demo/thing/src/index.ts'] } },
  }],
}

const entry = (files: string[], extra: Record<string, unknown> = {}) => ({ epic: 'P9-99', stage: 'U', files, ...extra })

describe('usageBaselineFiles', () => {
  it('is the intersection of stage-U and [B], not either one alone', () => {
    // `files[]` says which paths are baseline; `stages.U` says which the Usage
    // stage is about. A stage-U file that is [N] is this epic's own new code,
    // and a U stage touching only that is what the gate exists to catch.
    expect(usageBaselineFiles(registry.epics[0]!)).toEqual(['packages/host/consumer/src/index.ts'])
  })

  it('is empty when the row names no baseline consumer, which is itself the finding', () => {
    expect(usageBaselineFiles({ id: 'P9-98', files: [{ path: 'a.ts', kind: 'N' }], stages: { U: { files: ['a.ts'] } } })).toEqual([])
  })
})

describe('usageEntriesWithoutSubject', () => {
  it('accepts an entry that touches the declared consumer', () => {
    expect(usageEntriesWithoutSubject(registry, [entry(['packages/host/consumer/src/index.ts'])], {})).toEqual([])
  })

  it('reports an epic whose Usage touches only its own package', () => {
    const findings = usageEntriesWithoutSubject(registry, [entry(['packages/demo/thing/src/index.ts'])], {})
    expect(findings).toHaveLength(1)
    expect(findings[0]?.key).toBe('P9-99')
  })

  it('accepts the epic when a LATER supplement reaches the consumer the first entry missed', () => {
    // §12.24-3: asked per epic, not per entry. An early library-level entry
    // records what was observed at the SHA it was frozen against, and a
    // supplement that reaches the consumer does not make that observation
    // untrue — asking each entry separately would force the earlier one to be
    // superseded, rewriting provenance to satisfy a check about scope.
    expect(usageEntriesWithoutSubject(registry, [
      entry(['packages/demo/thing/src/index.ts']),
      entry(['packages/host/consumer/src/index.ts'], { supplementSeq: 3 }),
    ], {})).toEqual([])
  })

  it('still reports the epic when EVERY live entry misses the consumer', () => {
    // The failure the gate exists for survives the per-epic reading: a stage
    // that as a whole never reaches its consumer is red however many entries
    // it has.
    const findings = usageEntriesWithoutSubject(registry, [
      entry(['packages/demo/thing/src/index.ts']),
      entry(['packages/demo/thing/src/other.ts'], { supplementSeq: 2 }),
    ], {})
    expect(findings).toHaveLength(1)
    expect(findings[0]?.entries).toEqual(['P9-99.U', 'P9-99.U.2'])
  })

  it('skips a SUPERSEDED entry, which describes a shape the epic no longer promises', () => {
    expect(usageEntriesWithoutSubject(registry, [entry(['packages/demo/thing/src/index.ts'], { supersededBy: 'later' })], {})).toEqual([])
  })

  it('names every live entry behind a finding, so a reader can see which observations it covers', () => {
    const findings = usageEntriesWithoutSubject(registry, [entry(['packages/demo/thing/src/index.ts'], { supplementSeq: 2 })], {})
    expect(findings[0]?.key).toBe('P9-99')
    expect(findings[0]?.entries).toEqual(['P9-99.U.2'])
  })

  it('accepts an exemption carrying BOTH a BLOCKED entry and a ruling', () => {
    const exempt = { 'P9-99': { blocked: 'BLOCKED-999', ruling: '§12.x' } }
    expect(usageEntriesWithoutSubject(registry, [entry(['packages/demo/thing/src/index.ts'])], exempt)).toEqual([])
  })

  it('REFUSES an exemption missing either field, so an empty object is not an off switch', () => {
    // The case that keeps the exemption honest. Without it, `{"P9-99.U": {}}`
    // silences the finding while recording nothing a reader can check.
    for (const partial of [{}, { blocked: 'BLOCKED-999' }, { ruling: '§12.x' }]) {
      expect(usageEntriesWithoutSubject(registry, [entry(['packages/demo/thing/src/index.ts'])], { 'P9-99': partial }), JSON.stringify(partial))
        .toHaveLength(1)
    }
  })
})
