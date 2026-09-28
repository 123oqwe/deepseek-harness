/**
 * Controls for declared-files-exist: a live freeze entry's missing path is a
 * failure, and a registry reference never is.
 */
import { describe, expect, it } from 'vitest'

import { argvPathsOutsideFiles, judgeArgvExceptions, missingAcceptedRegistryRefs, missingFreezeFiles, neverDeliveredPairs } from './verify-declared-files-exist.mjs'

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
      additionsMissing: [],
      resolvedMissing: [],
    })
  })

  it('ignores an epic that is not ACCEPTED, whose plan paths need not exist yet', () => {
    expect(missingAcceptedRegistryRefs(registry, new Set(), exists, []))
      .toStrictEqual({ declaredMissing: [], neverDelivered: [], additionsMissing: [], resolvedMissing: [] })
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
      .toStrictEqual({ declaredMissing: [], neverDelivered: [], additionsMissing: [], resolvedMissing: [{ where: 'P9-98.U', path: present, absentApprovedPaths: [absentTarget] }] })
  })

  it('stays silent for the same absent approved path under a substitution, whose declared path is expected to remain', () => {
    const substitution = { epic: 'P9-98', stage: 'U', declaredPath: present, approvedPath: absentTarget, kind: 'substitution' as const }
    expect(missingAcceptedRegistryRefs(presentRegistry, new Set(['P9-98']), exists, [substitution]))
      .toStrictEqual({ declaredMissing: [], neverDelivered: [], additionsMissing: [], resolvedMissing: [] })
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

describe('approved additions, reported by what expectedAt promises', () => {
  const registry = { epics: [{ id: 'P9-98', files: [{ path: 'packages/demo/thing/src/here.ts' }], stages: { P: { files: ['packages/demo/thing/src/here.ts'] } } }] }
  const addition = (fields: Record<string, unknown>) => [{
    epic: 'P9-98', stage: 'P', path: 'packages/demo/thing/src/absent.ts', reason: 'the stage must change it',
    declaredBy: [], overlay: 'none', expectedAt: 'tree', rulingRef: 'delegate ruling', ...fields,
  }] as unknown as Parameters<typeof missingAcceptedRegistryRefs>[5]

  it('reports a tree addition that is absent, whether or not the epic is accepted', () => {
    const accepted = missingAcceptedRegistryRefs(registry, new Set(['P9-98']), exists, [], new Set(), addition({}))
    const unstarted = missingAcceptedRegistryRefs(registry, new Set(), exists, [], new Set(), addition({}))
    expect(accepted.additionsMissing).toStrictEqual([{ where: 'P9-98.P', path: 'packages/demo/thing/src/absent.ts', expectedAt: 'tree' }])
    expect(unstarted.additionsMissing).toStrictEqual(accepted.additionsMissing)
    expect(accepted.declaredMissing.map(row => row.path)).not.toContain('packages/demo/thing/src/absent.ts')
  })

  it('reports a stage addition only once its epic is ACCEPTED, because before that its absence is the plan', () => {
    const unstarted = missingAcceptedRegistryRefs(registry, new Set(), exists, [], new Set(), addition({ expectedAt: 'stage' }))
    const accepted = missingAcceptedRegistryRefs(registry, new Set(['P9-98']), exists, [], new Set(), addition({ expectedAt: 'stage' }))
    expect(unstarted.additionsMissing).toStrictEqual([])
    expect(accepted.additionsMissing).toStrictEqual([{ where: 'P9-98.P', path: 'packages/demo/thing/src/absent.ts', expectedAt: 'stage' }])
  })

  it('says nothing about an addition whose file is in the tree', () => {
    const result = missingAcceptedRegistryRefs(registry, new Set(['P9-98']), exists, [], new Set(), addition({ path: 'packages/other/moved/src/gone.ts' }))
    expect(result.additionsMissing).toStrictEqual([])
  })
})

describe('argvPathsOutsideFiles: files name every test the argv runs (B-584)', () => {
  const trackedPaths = ['pkg/a/tests/one.spec.ts', 'pkg/a/tests/two.spec.ts', 'pkg/a/tests/helper.ts', 'pkg/a/src/index.ts']
  const frozen = (argvPaths: readonly string[], files: readonly string[], fields: { readonly supersededBy?: string } = {}) =>
    ({ epic: 'P9-99', stage: 'U', argv: ['pnpm', 'exec', 'vitest', 'run', ...argvPaths, '--reporter=json'], files, ...fields })

  it('names a file argument that files does not list', () => {
    expect(argvPathsOutsideFiles([frozen(['pkg/a/tests/one.spec.ts'], ['pkg/a/src/index.ts'])], trackedPaths))
      .toStrictEqual([{ index: 0, label: 'P9-99.U', uncovered: ['pkg/a/tests/one.spec.ts'] }])
  })

  it('covers a file argument that files lists, or that sits under a directory files lists', () => {
    expect(argvPathsOutsideFiles([
      frozen(['pkg/a/tests/one.spec.ts'], ['pkg/a/tests/one.spec.ts']),
      frozen(['pkg/a/tests/one.spec.ts'], ['pkg/a/tests/']),
    ], trackedPaths)).toStrictEqual([])
  })

  it('names a directory argument while a test file below it is unlisted, and covers it once every one is listed or the directory is', () => {
    expect(argvPathsOutsideFiles([frozen(['pkg/a/tests/'], ['pkg/a/tests/one.spec.ts'])], trackedPaths))
      .toStrictEqual([{ index: 0, label: 'P9-99.U', uncovered: ['pkg/a/tests/ (unlisted below it: pkg/a/tests/two.spec.ts)'] }])
    expect(argvPathsOutsideFiles([
      frozen(['pkg/a/tests/'], ['pkg/a/tests/one.spec.ts', 'pkg/a/tests/two.spec.ts']),
      frozen(['pkg/a'], ['pkg/a']),
    ], trackedPaths)).toStrictEqual([])
  })

  it('names an argument that is neither a tracked file nor a tracked directory, since what it runs cannot be judged', () => {
    expect(argvPathsOutsideFiles([frozen(['pkg/a/tests/gone.spec.ts'], ['pkg/a/src/index.ts'])], trackedPaths))
      .toStrictEqual([{ index: 0, label: 'P9-99.U', uncovered: ['pkg/a/tests/gone.spec.ts (no tracked file or directory)'] }])
  })

  it('reads past option values and skips superseded entries, reporting each live entry by its index in the file', () => {
    const titled = { epic: 'P9-99', stage: 'F', argv: ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', 'pkg/a/tests/two.spec.ts', '-t', 'pkg/a/tests/one.spec.ts'], files: ['pkg/a/tests/two.spec.ts'] }
    expect(argvPathsOutsideFiles([
      frozen(['pkg/a/tests/one.spec.ts'], [], { supersededBy: '2026-09-28T00:00:00.000Z' }),
      titled,
      frozen(['pkg/a/tests/two.spec.ts'], []),
    ], trackedPaths)).toStrictEqual([{ index: 2, label: 'P9-99.U', uncovered: ['pkg/a/tests/two.spec.ts'] }])
  })
})

describe('judgeArgvExceptions: the exception table for ACCEPTED rows expires (B-584)', () => {
  const listedEntry = { epic: 'P9-98', stage: 'U', frozenAtUtc: '2026-09-01T00:00:00Z', argv: ['pnpm', 'exec', 'vitest', 'run', 'pkg/a/tests/one.spec.ts'], files: [] }
  const otherEntry = { epic: 'P9-99', stage: 'U', frozenAtUtc: '2026-09-02T00:00:00Z', argv: ['pnpm', 'exec', 'vitest', 'run', 'pkg/a/tests/two.spec.ts'], files: [] }
  const entries = [listedEntry, otherEntry]
  const violations = [
    { index: 0, label: 'P9-98.U', uncovered: ['pkg/a/tests/one.spec.ts'] },
    { index: 1, label: 'P9-99.U', uncovered: ['pkg/a/tests/two.spec.ts'] },
  ]
  const excepting = (fields: Record<string, unknown> = {}) => ({
    exceptions: [{ index: 0, epic: 'P9-98', stage: 'U', frozenAtUtc: '2026-09-01T00:00:00Z', expiresOn: '2026-10-12', reason: 'ACCEPTED row', ...fields }],
  }) as unknown as Parameters<typeof judgeArgvExceptions>[1]
  const accepted = (epic: string): string | undefined => epic === 'P9-98' ? 'ACCEPTED' : 'BLOCKED_ON_ACCEPTANCE'

  it('excuses a listed violation of an ACCEPTED row through its expiry date, that day included', () => {
    const judged = judgeArgvExceptions(violations.filter(violation => violation.index === 0), excepting(), entries, accepted, '2026-10-12')
    expect(judged).toStrictEqual({ unexcused: [], invalid: [] })
  })

  it('fails a violation the table does not list', () => {
    expect(judgeArgvExceptions(violations, excepting(), entries, accepted, '2026-09-28').unexcused.map(violation => violation.label)).toStrictEqual(['P9-99.U'])
  })

  it('fails an exception once its expiry date has passed', () => {
    expect(judgeArgvExceptions(violations, excepting(), entries, accepted, '2026-10-13').invalid)
      .toStrictEqual([{ index: 0, reason: 'the exception expired on 2026-10-12; supersede the entry with its files completed' }])
  })

  it('fails an exception whose row is no longer ACCEPTED', () => {
    expect(judgeArgvExceptions(violations, excepting(), entries, () => 'BLOCKED_ON_ACCEPTANCE', '2026-09-28').invalid)
      .toStrictEqual([{ index: 0, reason: 'the row is BLOCKED_ON_ACCEPTANCE, not ACCEPTED; supersede the entry with its files completed' }])
  })

  it('fails an exception whose entry no longer breaks the rule, or was superseded', () => {
    expect(judgeArgvExceptions([], excepting(), entries, accepted, '2026-09-28').invalid.map(row => row.reason))
      .toStrictEqual(['the entry no longer breaks the rule; remove the exception'])
    const superseded = [{ ...listedEntry, supersededBy: '2026-09-28T00:00:00Z' }, otherEntry]
    expect(judgeArgvExceptions([], excepting(), superseded, accepted, '2026-09-28').invalid.map(row => row.reason))
      .toStrictEqual(['the entry was superseded; remove the exception'])
  })

  it('fails an exception that names another entry at its index, or lists an index twice', () => {
    expect(judgeArgvExceptions(violations, excepting({ frozenAtUtc: '2026-09-03T00:00:00Z' }), entries, accepted, '2026-09-28').invalid.map(row => row.reason))
      .toStrictEqual(['no freeze entry P9-98.U frozen at 2026-09-03T00:00:00Z sits at this index'])
    const twice = { exceptions: [...excepting().exceptions, ...excepting().exceptions] }
    expect(judgeArgvExceptions(violations, twice, entries, accepted, '2026-09-28').invalid.map(row => row.reason))
      .toStrictEqual(['the table lists this index twice'])
  })
})
