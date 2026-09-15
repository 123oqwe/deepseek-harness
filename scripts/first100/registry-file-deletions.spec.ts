/**
 * Controls for registry-file-deletions: a deleted file leaves the stage that declared it, and the epic's
 * `files` only once no stage lists it; a record that disagrees with the row throws.
 */
import { describe, expect, it } from 'vitest'

import { applyFileDeletions } from './registry-file-deletions.mjs'
import type { DeletableRow, FileDeletionRecord } from './registry-file-deletions.d.mts'

const gone = 'packages/session/session-persistence/src/coordinator.ts'
const kept = 'packages/run/message-bus/src/index.ts'
const row = (): DeletableRow => ({
  files: [{ path: kept, kind: 'B' }, { path: gone, kind: 'B' }],
  stages: { P: { files: [kept, gone], count: 2 }, F: { files: [gone], count: 1 } },
})
const record = (deleted: FileDeletionRecord['deleted']): FileDeletionRecord => ({ deleted, reason: 'deleted by the handle-based seam', authorization: 'delegate ruling' })

describe('applyFileDeletions', () => {
  it('removes the path from the named stage, keeps count equal to the list, and keeps the epic-level entry while another stage lists it', () => {
    const epic = row()
    applyFileDeletions('P9-99', epic, record([{ path: gone, stage: 'P', deletedBy: 'bec6805d6a' }]))
    expect(epic.stages).toStrictEqual({ P: { files: [kept], count: 1 }, F: { files: [gone], count: 1 } })
    expect(epic.files.map(file => file.path)).toStrictEqual([kept, gone])
  })

  it('removes the epic-level entry once no stage lists the path', () => {
    const epic = row()
    applyFileDeletions('P9-99', epic, record([{ path: gone, stage: 'P', deletedBy: 'bec6805d6a' }, { path: gone, stage: 'F', deletedBy: 'bec6805d6a' }]))
    expect(epic.stages).toStrictEqual({ P: { files: [kept], count: 1 }, F: { files: [], count: 0 } })
    expect(epic.files).toStrictEqual([{ path: kept, kind: 'B' }])
  })

  it('throws for a stage that does not declare the path, and for a deletion with no deleting commit', () => {
    expect(() => { applyFileDeletions('P9-99', row(), record([{ path: kept, stage: 'F', deletedBy: 'bec6805d6a' }])) }).toThrow('expects packages/run/message-bus/src/index.ts in stage F')
    expect(() => { applyFileDeletions('P9-99', row(), record([{ path: gone, stage: 'P', deletedBy: 'HEAD' }])) }).toThrow('names no deleting commit')
  })

  it('leaves a row with no record unchanged', () => {
    const epic = row()
    applyFileDeletions('P9-99', epic, undefined)
    expect(epic).toStrictEqual(row())
  })
})
