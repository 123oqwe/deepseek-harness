/**
 * Controls for declared-files-exist: a live freeze entry's missing path is a
 * failure, and a registry reference never is.
 */
import { describe, expect, it } from 'vitest'

import { missingAcceptedRegistryRefs, missingFreezeFiles, neverDeliveredPairs } from './verify-declared-files-exist.mjs'

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
      neverDelivered: [],
      resolvedMissing: [],
    })
  })

  it('ignores an epic that is not ACCEPTED, whose plan paths need not exist yet', () => {
    expect(missingAcceptedRegistryRefs(registry, new Set(), exists, []))
      .toStrictEqual({ declaredMissing: [], neverDelivered: [], resolvedMissing: [] })
  })

  const declared = 'packages/demo/thing/tests/plan.e2e.ts'
  const approved = 'packages/demo/thing/src/here.ts'
  const absentTarget = 'packages/demo/thing/tests/never.e2e.spec.ts'
  const patchedRegistry = { epics: [{ id: 'P9-98', files: [{ path: declared }], stages: { C: { files: [declared] }, F: { files: [declared] } } }] }
  const patch = (fields: { epic?: string; stage?: string; approvedPath?: string; kind?: 'widening' | 'substitution' }) => ({ epic: 'P9-98', stage: 'C', declaredPath: declared, approvedPath: approved, kind: 'substitution' as const, ...fields })

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

  it('reports an absent declared path under a widening patch as declared-missing, although its approved path exists', () => {
    const { declaredMissing, resolvedMissing } = missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({ kind: 'widening' })])
    expect(declaredMissing).toContainEqual({ where: 'P9-98.C', path: declared })
    expect(resolvedMissing.map(row => row.where)).not.toContain('P9-98.C')
  })

  it('still reports it when a substitution and a widening patch share the declaration, since the widening keeps the path a deliverable', () => {
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({}), patch({ kind: 'widening', approvedPath: 'packages/other/moved/src/gone.ts' })]).declaredMissing)
      .toContainEqual({ where: 'P9-98.C', path: declared })
  })

  it('stays silent for an absent declared path under a substitution patch whose approved path exists', () => {
    const { declaredMissing, resolvedMissing } = missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({ kind: 'substitution' })])
    expect(declaredMissing).not.toContainEqual({ where: 'P9-98.C', path: declared })
    expect(resolvedMissing.map(row => row.where)).not.toContain('P9-98.C')
  })

  const present = 'packages/demo/thing/src/here.ts'
  const presentRegistry = { epics: [{ id: 'P9-98', files: [], stages: { U: { files: [present] } } }] }

  it('reports an absent approved path under a widening patch as resolved-missing, naming it, although the declared path exists', () => {
    const widening = { epic: 'P9-98', stage: 'U', declaredPath: present, approvedPath: absentTarget, kind: 'widening' as const }
    expect(missingAcceptedRegistryRefs(presentRegistry, new Set(['P9-98']), exists, [widening]))
      .toStrictEqual({ declaredMissing: [], neverDelivered: [], resolvedMissing: [{ where: 'P9-98.U', path: present, absentApprovedPaths: [absentTarget] }] })
  })

  it('stays silent for the same absent approved path under a substitution, whose declared path is expected to remain', () => {
    const substitution = { epic: 'P9-98', stage: 'U', declaredPath: present, approvedPath: absentTarget, kind: 'substitution' as const }
    expect(missingAcceptedRegistryRefs(presentRegistry, new Set(['P9-98']), exists, [substitution]))
      .toStrictEqual({ declaredMissing: [], neverDelivered: [], resolvedMissing: [] })
  })

  it('does not apply a patch of another epic', () => {
    expect(missingAcceptedRegistryRefs(patchedRegistry, new Set(['P9-98']), exists, [patch({ epic: 'P9-97' })]).declaredMissing)
      .toContainEqual({ where: 'P9-98.C', path: declared })
  })
})

describe('neverDeliveredPairs, and the rows it moves out of declared-missing', () => {
  const NUL = String.fromCharCode(0)
  const registry = {
    epics: [{ id: 'P9-98', files: [{ path: 'packages/demo/thing/src/plan.ts' }], stages: { C: { files: ['packages/demo/thing/src/plan.ts'] } } }],
  }
  const declaredPaths = new Set([`P9-98${NUL}packages/demo/thing/src/plan.ts`])
  const entry = {
    epic: 'P9-98',
    path: 'packages/demo/thing/src/plan.ts',
    reason: 'No commit in this lineage ever added it.',
    rulingRef: 'delegate ruling, 2026-09-15',
  }

  it('reports a recorded reference as never-delivered instead of declared-missing, and leaves the others where they were', () => {
    const pairs = neverDeliveredPairs({ entries: [entry] }, declaredPaths, exists)
    const result = missingAcceptedRegistryRefs(registry, new Set(['P9-98']), exists, [], pairs)
    expect(result.neverDelivered).toStrictEqual([
      { where: 'P9-98', path: 'packages/demo/thing/src/plan.ts' },
      { where: 'P9-98.C', path: 'packages/demo/thing/src/plan.ts' },
    ])
    expect(result.declaredMissing).toStrictEqual([])
  })

  it('leaves every row as declared-missing when there is no record', () => {
    expect(missingAcceptedRegistryRefs(registry, new Set(['P9-98']), exists, []).declaredMissing).toHaveLength(2)
    expect(neverDeliveredPairs(undefined, declaredPaths, exists).size).toBe(0)
  })

  it('refuses a record whose file exists, because that declaration is satisfied', () => {
    expect(() => neverDeliveredPairs({ entries: [{ ...entry, path: 'packages/demo/thing/src/here.ts' }] }, new Set([`P9-98${NUL}packages/demo/thing/src/here.ts`]), exists))
      .toThrow('exists in the tree')
  })

  it('refuses a record for a path the epic does not declare, because it has no subject', () => {
    expect(() => neverDeliveredPairs({ entries: [{ ...entry, path: 'packages/demo/thing/src/other.ts' }] }, declaredPaths, exists))
      .toThrow('does not declare')
  })

  it('refuses a record with no ruling behind it', () => {
    expect(() => neverDeliveredPairs({ entries: [{ ...entry, rulingRef: '' }] }, declaredPaths, exists)).toThrow('has no rulingRef')
    expect(() => neverDeliveredPairs({ entries: [{ ...entry, reason: '  ' }] }, declaredPaths, exists)).toThrow('needs epic, path and reason')
  })
})
