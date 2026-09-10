/**
 * Epic P1-10's Contract stage: the migration decisions, as decisions.
 *
 * Every case is a pure call, which is the stage and also its limit, stated
 * plainly. These prove the manifest vocabulary DECIDES correctly, not that any
 * upgrade consults it: must[1]'s six-phase transaction is an ordering over
 * real effects and closes at the Provider stage, and acceptance[0]'s crash
 * campaign closes at Usage against the real path.
 *
 * must[2] is split for a measured reason, recorded here because a reader of
 * green cells would otherwise assume the approval happens:
 * `requiresApprovalAndExport` decides that one is OWED. Nothing asks yet.
 * `@deepseek-ai/dsh-user-approval` cannot serve it today — its request carries
 * a `toolName` and it throws outside an open turn, while a plugin upgrade is a
 * CLI command with neither.
 */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'

import {
  admitIrreversibleUpgrade,
  computeMigrationPathDigest,
  findAmbiguousEdge,
  findMigrationCycle,
  planUpgrade,
  reconcileSnapshot,
  refuseOutsidePluginStorage,
  requiresApprovalAndExport,
} from '@deepseek-ai/dsh-plugin-migrations'
import type {
  PluginDataDigest,
  PluginDataSnapshot,
  PluginMigration,
  PluginMigrationManifest,
  PluginSchemaVersion,
} from '@deepseek-ai/dsh-plugin-migrations'

const v = (name: string): PluginSchemaVersion => brandString<PluginSchemaVersion>(name)
const digest = (name: string): PluginDataDigest => brandString<PluginDataDigest>(name)

function step(from: string, to: string, overrides: Partial<PluginMigration> = {}): PluginMigration {
  return { from: v(from), to: v(to), backup: { kind: 'snapshot' }, reversible: true, ...overrides }
}

function manifest(current: string, migrations: readonly PluginMigration[]): PluginMigrationManifest {
  return { plugin: 'dsh-notes', current: v(current), migrations }
}

describe('P1-10 must[0]: the declared DAG must be runnable at all', () => {
  it('names the CYCLE rather than reporting a depth limit', () => {
    // An operator reading "these versions form a cycle" knows which
    // declarations to fix; one reading "too many steps" cannot tell a loop
    // from a long history.
    const cyclic = findMigrationCycle(manifest('3', [step('1', '2'), step('2', '3'), step('3', '1')]))
    expect(cyclic).toEqual({ kind: 'cyclic', versions: [v('1'), v('2'), v('3'), v('1')] })
  })

  it('admits a long chain, so the refusal is about looping and not about length', () => {
    const long = Array.from({ length: 40 }, (_unused, index) => step(String(index), String(index + 1)))
    expect(findMigrationCycle(manifest('40', long))).toBeUndefined()
  })

  it('refuses TWO migrations leaving one version instead of picking between them', () => {
    // A manifest declaring two ways forward has not said which is correct, and
    // an upgrade that chose one would be deciding on the author's behalf about
    // their own data.
    expect(findAmbiguousEdge(manifest('3', [step('1', '2'), step('1', '3')])))
      .toEqual({ kind: 'ambiguous-edge', from: v('1') })
    expect(findAmbiguousEdge(manifest('3', [step('1', '2'), step('2', '3')]))).toBeUndefined()
  })
})

describe('P1-10 must[0]: which steps an upgrade would take', () => {
  it('walks the chain from the installed version to the manifest’s current one', () => {
    const plan = planUpgrade(manifest('3', [step('1', '2'), step('2', '3')]), v('1'))
    expect(plan).toMatchObject({ admitted: true, reversible: true })
    expect(plan.admitted && plan.steps.map(each => `${each.from}->${each.to}`)).toEqual(['1->2', '2->3'])
  })

  it('admits an already-current plugin with NO steps, rather than refusing it', () => {
    // An upgrade that has nothing to do is not a failure; refusing it would
    // make a no-op run report an error an operator would then chase.
    expect(planUpgrade(manifest('3', [step('1', '2'), step('2', '3')]), v('3')))
      .toEqual({ admitted: true, steps: [], reversible: true })
  })

  it('refuses an unreachable target naming BOTH ends, not just the missing edge', () => {
    expect(planUpgrade(manifest('4', [step('1', '2')]), v('1')))
      .toEqual({ admitted: false, refusal: { kind: 'unreachable', from: v('1'), to: v('4') } })
  })

  it('reports preconditions rather than deciding them', () => {
    // This module cannot know whether a disk is writable or an external system
    // is reachable. A precondition it silently treated as satisfied would be
    // an upgrade admitted on an assumption nobody made.
    const gated = step('1', '2', {
      preconditions: [{ id: 'disk-space', requirement: 'at least twice the data size is free' }],
    })
    expect(planUpgrade(manifest('2', [gated]), v('1'))).toEqual({
      admitted: false,
      refusal: { kind: 'preconditions-undecided', preconditions: gated.preconditions },
    })
  })

  it('refuses a cyclic manifest BEFORE walking it, so the walk cannot loop', () => {
    expect(planUpgrade(manifest('2', [step('1', '2'), step('2', '1')]), v('1')))
      .toMatchObject({ admitted: false, refusal: { kind: 'cyclic' } })
  })
})

describe('P1-10 must[2]: an irreversible upgrade owes approval and an export', () => {
  it('is owed when ANY step on the path is irreversible', () => {
    // Reversibility is a property of the PATH: one one-way conversion in the
    // middle makes the whole upgrade one-way, and the approval is owed for the
    // path rather than for the step.
    const plan = planUpgrade(manifest('3', [step('1', '2', { reversible: false }), step('2', '3')]), v('1'))
    expect(plan).toMatchObject({ admitted: true, reversible: false })
    expect(requiresApprovalAndExport(plan)).toBe(true)
  })

  it('is NOT owed when every step is reversible, so the rule is not a constant', () => {
    expect(requiresApprovalAndExport(planUpgrade(manifest('3', [step('1', '2'), step('2', '3')]), v('1')))).toBe(false)
  })

  it('is not owed for a REFUSED plan, which is not going to run', () => {
    expect(requiresApprovalAndExport(planUpgrade(manifest('4', [step('1', '2')]), v('1')))).toBe(false)
  })

  it('reads the DECLARED reversibility, not the backup strategy', () => {
    // The two answer different questions: a snapshot makes the data
    // restorable, while reversibility is about whether the migration's effects
    // are confined to that data. A migration that also rewrote an external
    // system is irreversible however good its snapshot is.
    const snapshotted = step('1', '2', { backup: { kind: 'snapshot' }, reversible: false })
    expect(requiresApprovalAndExport(planUpgrade(manifest('2', [snapshotted]), v('1')))).toBe(true)
    const unbacked = step('1', '2', { backup: { kind: 'none' }, reversible: true })
    expect(requiresApprovalAndExport(planUpgrade(manifest('2', [unbacked]), v('1')))).toBe(false)
  })
})

describe('P1-10 acceptance[1]: a snapshot reconciles with what it claims to cover', () => {
  const snapshot: PluginDataSnapshot = {
    plugin: 'dsh-notes',
    version: v('2'),
    digest: digest('sha256-abc'),
    path: '/home/u/.dsh/plugins/dsh-notes/snapshots/2',
  }

  it('accepts a snapshot of the same plugin at the same version', () => {
    expect(reconcileSnapshot(snapshot, 'dsh-notes', v('2'))).toBeUndefined()
  })

  it('refuses another PLUGIN’s snapshot, which is a wiring mistake', () => {
    expect(reconcileSnapshot(snapshot, 'dsh-tasks', v('2')))
      .toEqual({ kind: 'snapshot-mismatch', expected: 'dsh-tasks', actual: 'dsh-notes' })
  })

  it('refuses another VERSION’s snapshot, which would restore an unreadable shape', () => {
    expect(reconcileSnapshot(snapshot, 'dsh-notes', v('3')))
      .toEqual({ kind: 'snapshot-mismatch', expected: v('3'), actual: v('2') })
  })
})

describe('P1-10: a workspace path is refused, not unsupported (P3-11’s boundary)', () => {
  const root = '/home/u/.dsh/plugins/dsh-notes'

  it('admits a path inside the plugin’s own storage', () => {
    expect(refuseOutsidePluginStorage(`${root}/snapshots/2`, root)).toBeUndefined()
  })

  it('refuses a workspace path, which P3-11 checkpoints and this epic must not', () => {
    expect(refuseOutsidePluginStorage('/home/u/projects/app/src', root))
      .toEqual({ kind: 'outside-plugin-storage', path: '/home/u/projects/app/src' })
  })

  it('refuses a SIBLING whose name merely starts with the root’s', () => {
    // Without the separator in the comparison, `dsh-notes-backup` reads as
    // being inside `dsh-notes`, and a plugin could declare its neighbour's
    // storage as its own backup target.
    expect(refuseOutsidePluginStorage(`${root}-backup/snapshots/2`, root))
      .toEqual({ kind: 'outside-plugin-storage', path: `${root}-backup/snapshots/2` })
  })
})

describe('P1-10 must[2]: an irreversible upgrade proceeds only on an operator confirmation', () => {
  const oneWay = manifest('2', [step('1', '2', { reversible: false })])
  const plan = planUpgrade(oneWay, v('1'))
  const digestOf = (): ReturnType<typeof computeMigrationPathDigest> =>
    computeMigrationPathDigest('dsh-notes', plan.admitted ? plan.steps : [])

  it('REFUSES with no confirmation, naming the digest the operator must confirm', () => {
    // Absence is a refusal, never a default: an upgrade that proceeded on
    // silence would make the approval a formality in the one case it exists
    // for. The digest is named so a non-interactive operator can supply it.
    expect(admitIrreversibleUpgrade('dsh-notes', plan))
      .toEqual({ kind: 'confirmation-required', digest: digestOf() })
  })

  it('REFUSES a confirmation obtained for a DIFFERENT path', () => {
    // The reason the confirmation names a digest at all. A manifest edited
    // between the operator reading it and the upgrade running produces a
    // different digest, and the confirmation stops matching rather than
    // silently covering the new conversion.
    const other = computeMigrationPathDigest('dsh-notes', [step('1', '9', { reversible: false })])
    expect(admitIrreversibleUpgrade('dsh-notes', plan, { digest: other, exportPath: '/tmp/export.json' }))
      .toEqual({ kind: 'confirmation-mismatch', expected: digestOf(), supplied: other })
  })

  it('REFUSES a matching confirmation with NO export, because the export comes first', () => {
    // An operator confirming an irreversible conversion is confirming they can
    // still get their data out. Accepting the confirmation first would let the
    // export fail after the point of no return.
    expect(admitIrreversibleUpgrade('dsh-notes', plan, { digest: digestOf() }))
      .toEqual({ kind: 'export-missing', digest: digestOf() })
  })

  it('ADMITS a matching confirmation that carries an export', () => {
    expect(admitIrreversibleUpgrade('dsh-notes', plan, { digest: digestOf(), exportPath: '/tmp/export.json' }))
      .toBeUndefined()
  })

  it('asks nothing of a REVERSIBLE upgrade, so the gate is scoped to must[2]', () => {
    // Without this, an implementation that demanded confirmation for every
    // upgrade would satisfy every case above.
    expect(admitIrreversibleUpgrade('dsh-notes', planUpgrade(manifest('2', [step('1', '2')]), v('1'))))
      .toBeUndefined()
  })

  it('gives two DIFFERENT step lists different digests, so one confirmation cannot cover both', () => {
    // Length-prefixed for the reason computeDefinitionDigest is. These two
    // step lists CONCATENATE to the same bytes -- "1"+"2"+"34"+"5" and
    // "12"+"3"+"4"+"5" are both "12345" -- so without the prefix a
    // confirmation obtained for one path would admit the other. The pair is
    // constructed to collide rather than merely to differ: a pair that did not
    // collide would leave the mutation green, which is what happened to the
    // first version of this case.
    const a = computeMigrationPathDigest('p', [step('1', '2'), step('34', '5')])
    const b = computeMigrationPathDigest('p', [step('12', '3'), step('4', '5')])
    expect(a).not.toBe(b)
    // And the same path digests the same, so the check is not merely
    // returning something new each call.
    expect(computeMigrationPathDigest('p', [step('1', '2')]))
      .toBe(computeMigrationPathDigest('p', [step('1', '2')]))
  })
})
