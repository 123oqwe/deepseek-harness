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
      { id: 'P9-99', files: [{ path: 'packages/demo/thing/src/unbuilt.ts' }], stages: {} },
    ],
  }

  it('lists the absent epic and stage references of an ACCEPTED epic as declared-missing', () => {
    expect(missingAcceptedRegistryRefs(registry, new Set(['P9-98']), exists, [])).toStrictEqual({
      declaredMissing: [
        { where: 'P9-98', path: 'packages/demo/thing/src/plan.ts' },
        { where: 'P9-98.C', path: 'packages/demo/thing/tests/plan.spec.ts' },
      ],
      resolvedMissing: [],
    })
  })

  it('ignores an epic that is not ACCEPTED, whose plan paths need not exist yet', () => {
    expect(missingAcceptedRegistryRefs(registry, new Set(), exists, [])).toStrictEqual({ declaredMissing: [], resolvedMissing: [] })
  })

  const declared = 'packages/demo/thing/tests/plan.e2e.ts'
  const approved = 'packages/demo/thing/src/here.ts'
  const absentTarget = 'packages/demo/thing/tests/never.e2e.spec.ts'
  const patchedRegistry = { epics: [{ id: 'P9-98', files: [{ path: declared }], stages: { C: { files: [declared] }, F: { files: [declared] } } }] }
  const patch = (fields: Record<string, string>) => ({ epic: 'P9-98', stage: 'C', declaredPath: declared, approvedPath: approved, ...fields })

  it('reports nothing for a stage reference whose patch target exists', () => {
    const { declaredMissing, resolvedMissing } = missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({})])
    expect(declaredMissing).not.toContainEqual({ where: 'P9-98.C', path: declared })
    expect(resolvedMissing.map(row => row.where)).not.toContain('P9-98.C')
  })

  it('keeps a stage reference declared-missing when the only patch names a different stage', () => {
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({})]).declaredMissing).toContainEqual({ where: 'P9-98.F', path: declared })
  })

  it('resolves an epic-level reference through a patch of any stage of that epic', () => {
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({ stage: 'F' })]).declaredMissing)
      .not.toContainEqual({ where: 'P9-98', path: declared })
  })

  it('reports resolved-missing, naming the absent target, when one of several approved paths is absent', () => {
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({}), patch({ approvedPath: absentTarget })]).resolvedMissing)
      .toContainEqual({ where: 'P9-98.C', path: declared, absentApprovedPaths: [absentTarget] })
  })

  it('does not apply a patch of another epic', () => {
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({ epic: 'P9-97' })]).declaredMissing)
      .toContainEqual({ where: 'P9-98.C', path: declared })
  })
})
