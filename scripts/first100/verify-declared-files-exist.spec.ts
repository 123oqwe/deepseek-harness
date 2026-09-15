/**
 * Controls for declared-files-exist: a live freeze entry's missing path is a
 * failure, and a registry reference never is.
 */
import { describe, expect, it } from 'vitest'

import { missingAcceptedRegistryRefs, missingFreezeFiles } from './verify-declared-files-exist.mjs'

const tree = new Set(['packages/demo/thing/src/here.ts', 'packages/other/moved/src/gone.ts'])
const exists = (path: string): boolean => tree.has(path)
const index = new Map([['gone.ts', ['packages/other/moved/src/gone.ts']], ['here.ts', ['packages/demo/thing/src/here.ts']]])

describe('missingFreezeFiles', () => {
  it('names a live entry path that does not exist, with the tracked file of the same name', () => {
    const entries = [{ epic: 'P9-99', stage: 'U', files: ['packages/demo/thing/src/here.ts', 'packages/demo/thing/src/gone.ts'] }]
    expect(missingFreezeFiles(entries, exists, index))
      .toStrictEqual([{ label: 'P9-99.U', path: 'packages/demo/thing/src/gone.ts', sameNameElsewhere: ['packages/other/moved/src/gone.ts'] }])
  })

  it('reports no same-name hint when no tracked file has the name', () => {
    const entries = [{ epic: 'P9-99', stage: 'C', files: ['packages/demo/thing/src/never.ts'] }]
    expect(missingFreezeFiles(entries, exists, index)).toStrictEqual([{ label: 'P9-99.C', path: 'packages/demo/thing/src/never.ts', sameNameElsewhere: [] }])
  })

  it('checks a supplement entry and addresses it by its sequence', () => {
    const entries = [{ epic: 'P9-99', stage: 'U', supplementSeq: 2, files: ['packages/demo/thing/src/never.ts'] }]
    expect(missingFreezeFiles(entries, exists, index).map(row => row.label)).toStrictEqual(['P9-99.U.2'])
  })

  it('skips a superseded entry, whose paths are history', () => {
    const entries = [{ epic: 'P9-99', stage: 'U', supersededBy: '2026-09-15T00:00:00Z', files: ['packages/demo/thing/src/never.ts'] }]
    expect(missingFreezeFiles(entries, exists, index)).toStrictEqual([])
  })

  it('accepts an entry whose paths all exist', () => {
    expect(missingFreezeFiles([{ epic: 'P9-99', stage: 'U', files: ['packages/demo/thing/src/here.ts'] }], exists, index)).toStrictEqual([])
  })
})

describe('missingAcceptedRegistryRefs', () => {
  const registry = {
    epics: [
      { id: 'P9-98', files: [{ path: 'packages/demo/thing/src/plan.ts' }], stages: { C: { files: ['packages/demo/thing/tests/plan.spec.ts'] } } },
      { id: 'P9-99', files: ['packages/demo/thing/src/unbuilt.ts'], stages: {} },
    ],
  }

  it('lists the absent epic and stage references of an ACCEPTED epic', () => {
    expect(missingAcceptedRegistryRefs(registry, new Set(['P9-98']), exists)).toStrictEqual([
      { where: 'P9-98', path: 'packages/demo/thing/src/plan.ts' },
      { where: 'P9-98.C', path: 'packages/demo/thing/tests/plan.spec.ts' },
    ])
  })

  it('ignores an epic that is not ACCEPTED, whose plan paths need not exist yet', () => {
    expect(missingAcceptedRegistryRefs(registry, new Set(), exists)).toStrictEqual([])
  })
})
