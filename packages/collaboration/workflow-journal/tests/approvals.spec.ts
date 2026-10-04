/**
 * Epic P2-07 U2: a run's journal records the approvals its script waited for
 * and what the run was started with, keeps both through a resume and a
 * compaction, and the store lists the runs that have a journal.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  compactJournal,
  createJournalRecorder,
  listJournals,
  readJournal,
  writeJournal,
  type JournaledApproval,
  type JournaledStart,
  type ScriptDigest,
} from '../src/index.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const digest = brandString<ScriptDigest>('digest')
const start: JournaledStart = { session: 'run-session', script: 'return 1', meta: { name: 'ship' }, route: { provider: 'mock' } }
const waiting: JournaledApproval = { key: 'k:1', approvalId: 'a-1', tenant: 'local', principal: 'agent:run-session', state: 'waiting' }

describe('P2-07 U2: the journal records what a run waited for', () => {
  it('records an approval and the start, marks it consumed, and keeps the first start', () => {
    const recorder = createJournalRecorder(digest)
    expect(recorder.journal()).toEqual({ scriptDigest: digest, entries: [] })
    recorder.approvalRecorded(waiting, start)
    recorder.approvalRecorded({ ...waiting, key: 'k:2', approvalId: 'a-2' }, { ...start, script: 'return 2' })
    recorder.approvalConsumed('k:1')
    recorder.approvalConsumed('never-recorded')

    expect(recorder.approvalFor('k:1')?.state).toBe('consumed')
    expect(recorder.approvalFor('never-recorded')).toBeUndefined()
    expect(recorder.journal()).toEqual({
      scriptDigest: digest,
      entries: [],
      start,
      approvals: [{ ...waiting, state: 'consumed' }, { ...waiting, key: 'k:2', approvalId: 'a-2' }],
    })
  })

  it('continues the approvals and start of the journal a resume is seeded with, and compaction keeps them', () => {
    const first = createJournalRecorder(digest)
    first.approvalRecorded(waiting, start)
    const resumed = createJournalRecorder(digest, first.journal())
    expect(resumed.approvalFor('k:1')).toEqual(waiting)
    expect(compactJournal(resumed.journal())).toMatchObject({ start, approvals: [waiting] })
  })
})

describe('P2-07 U2: the store lists the runs that have a journal', () => {
  it('lists each run with a journal, not one set aside or still being written, and none for a directory never written', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-journal-list-'))
    dirs.push(root)
    expect(listJournals(join(root, 'never-written'))).toEqual([])
    writeJournal(root, 'run-1', { scriptDigest: digest, entries: [] })
    writeJournal(root, 'run-2', { scriptDigest: digest, entries: [], start, approvals: [waiting] })
    mkdirSync(join(root, 'refused'), { recursive: true })
    writeFileSync(join(root, 'refused', 'run-3.json'), '{}')
    writeFileSync(join(root, 'run-4.json.tmp'), '{}')

    expect(listJournals(root).sort()).toEqual(['run-1', 'run-2'])
    expect(readJournal(root, 'run-2')?.approvals).toEqual([waiting])
  })

  it('surfaces a directory that cannot be listed rather than reading it as empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-journal-list-'))
    dirs.push(root)
    const file = join(root, 'not-a-directory')
    writeFileSync(file, '')
    expect(() => listJournals(file)).toThrow()
  })
})
