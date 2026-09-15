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
    expect(missingAcceptedRegistryRefs(registry, new Set(['P9-98']), exists, [])).toStrictEqual({
      absent: [
        { where: 'P9-98', path: 'packages/demo/thing/src/plan.ts' },
        { where: 'P9-98.C', path: 'packages/demo/thing/tests/plan.spec.ts' },
      ],
      patched: [],
    })
  })

  it('ignores an epic that is not ACCEPTED, whose plan paths need not exist yet', () => {
    expect(missingAcceptedRegistryRefs(registry, new Set(), exists, [])).toStrictEqual({ absent: [], patched: [] })
  })

  const declared = 'packages/demo/thing/tests/plan.e2e.ts'
  const approved = 'packages/demo/thing/src/here.ts'
  const patchedRegistry = { epics: [{ id: 'P9-98', files: [{ path: declared }], stages: { C: { files: [declared] }, F: { files: [declared] } } }] }

  it('reports a stage reference as patched when a patch for that stage names an approved path that exists', () => {
    const patches = [{ epic: 'P9-98', stage: 'C', declaredPath: declared, approvedPath: approved }]
    const { absent, patched } = missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, patches)
    expect(patched).toContainEqual({ where: 'P9-98.C', path: declared, approvedPath: approved })
    expect(absent).not.toContainEqual({ where: 'P9-98.C', path: declared })
  })

  it('keeps a stage reference absent when the only patch names a different stage', () => {
    const patches = [{ epic: 'P9-98', stage: 'C', declaredPath: declared, approvedPath: approved }]
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, patches).absent).toContainEqual({ where: 'P9-98.F', path: declared })
  })

  it('resolves an epic-level reference through any patch of that epic naming the same declared path', () => {
    const patches = [{ epic: 'P9-98', stage: 'F', declaredPath: declared, approvedPath: approved }]
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, patches).patched).toContainEqual({ where: 'P9-98', path: declared, approvedPath: approved })
  })

  it('keeps a patched reference absent when the approved path does not exist either', () => {
    const patches = [{ epic: 'P9-98', stage: 'C', declaredPath: declared, approvedPath: 'packages/demo/thing/tests/never.e2e.spec.ts' }]
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, patches).absent)
      .toContainEqual({ where: 'P9-98.C', path: declared, approvedPath: 'packages/demo/thing/tests/never.e2e.spec.ts' })
  })

  it('does not apply a patch of another epic', () => {
    const patches = [{ epic: 'P9-97', stage: 'C', declaredPath: declared, approvedPath: approved }]
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, patches).patched).toStrictEqual([])
  })
})
