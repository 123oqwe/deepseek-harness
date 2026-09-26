/**
 * BLOCKED-341: recovery undoes the unit an interrupted upgrade switched, as
 * its record names it, whatever the plugin is called; a record written before
 * records named their unit recovers as every record did before.
 */
import { describe, expect, it } from 'vitest'
import type { MigrationFacet, UnitSnapshot } from '@deepseek-ai/dsh-storage'

import { recoverUpgrade } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradeRecord } from '@deepseek-ai/dsh-plugin-migrations/transaction'

/**
 * A facet that records which unit and handle each undo names.
 * @returns the facet, and the undos it saw in order.
 */
function undoRecorder(): { readonly facet: MigrationFacet; readonly undone: string[] } {
  const undone: string[] = []
  const unreached = (): never => {
    throw new Error('recovery does not reach this primitive')
  }
  return {
    undone,
    facet: {
      stampedVersion: unreached,
      digestUnit: unreached,
      readSnapshot: unreached,
      exportUnit: unreached,
      snapshotUnit: unreached,
      materializeMigrated: unreached,
      switchIn: unreached,
      rollbackTo: async (previous: UnitSnapshot) => { undone.push(`rollbackTo ${previous.unit} ${previous.handle}`) },
      discard: async (snapshot: UnitSnapshot) => { undone.push(`discard ${snapshot.unit} ${snapshot.handle}`) },
    },
  }
}

/** An upgrade of `notes-plugin` interrupted after its switch, before its health check. */
const SWITCHED: UpgradeRecord = {
  plugin: 'notes-plugin',
  from: '1',
  to: '2',
  pathDigest: 'digest',
  snapshotHandle: 'snap-1',
  previousHandle: 'previous-1',
}

describe('BLOCKED-341: recovery undoes the unit the upgrade switched', () => {
  it('rolls back and discards the unit the record names, not a unit named after the plugin', async () => {
    const { facet, undone } = undoRecorder()

    expect(await recoverUpgrade(facet, { ...SWITCHED, unit: 'notes' })).toBe(true)
    expect(undone).toEqual(['rollbackTo notes previous-1', 'discard notes snap-1'])
  })

  it('recovers a record written before records named their unit as its plugin\'s unit, as every record was recovered before', async () => {
    const { facet, undone } = undoRecorder()

    expect(await recoverUpgrade(facet, SWITCHED)).toBe(true)
    expect(undone).toEqual(['rollbackTo notes-plugin previous-1', 'discard notes-plugin snap-1'])
  })
})
