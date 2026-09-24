/**
 * What identifies a journalled call survives the journal's own operations
 * (Epic P4-08 acceptance[0], acceptance[2]): compaction keeps a step's `call`,
 * and a step started for a different call, or for the same call over a
 * verified entry, keeps the entry it replaces.
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { compactJournal, createJournalRecorder, retainsAllReceipts } from '../src/index.ts'
import type {
  ArtifactRef,
  CallDigest,
  ChildReceipt,
  JournalEntry,
  PhaseName,
  ScriptDigest,
  SideEffectReceipt,
  StepId,
  WorkflowJournal,
} from '../src/types.ts'

const DIGEST = brandString<ScriptDigest>('sha256-script-v1')

/**
 * A completed, verified step recorded for `call`.
 * @param seq - the step number.
 * @param call - the identity of the call that recorded it.
 * @returns the entry.
 */
function recorded(seq: number, call: string): JournalEntry {
  return {
    stepId: brandString<StepId>(`step-${String(seq)}`),
    phase: brandString<PhaseName>('unphased'),
    effectClass: 'side-effecting',
    outcome: 'completed',
    inputs: [],
    output: brandString<ArtifactRef>(JSON.stringify(`output of ${call}`)),
    childReceipts: [brandString<ChildReceipt>(`child-of-${call}`)],
    sideEffectReceipts: [brandString<SideEffectReceipt>(`effect-of-${call}`)],
    call: brandString<CallDigest>(call),
    verified: true,
  }
}

describe('P4-08: a journal keeps what identifies a call', () => {
  it('keeps a verified step\'s call through compaction', () => {
    const journal: WorkflowJournal = { scriptDigest: DIGEST, entries: [recorded(1, 'call-a')] }

    expect(compactJournal(journal).entries[0]?.call).toBe('call-a')
  })

  it('keeps, whole, the entry a step started for a different call replaces at its step number', () => {
    const original = recorded(1, 'call-a')
    const recorder = createJournalRecorder(DIGEST, { scriptDigest: DIGEST, entries: [original] })

    recorder.stepStarted({ seq: 1, label: 'review', childId: 'child-of-call-b', call: 'call-b' }, 'side-effecting')

    expect(recorder.journal().entries[0]?.call).toBe('call-b')
    expect(recorder.journal().displaced).toStrictEqual([original])
  })

  it('keeps, whole, a verified entry that a step of the same call replaces at its step number', () => {
    // A resume hands each verified entry to the worker for reuse, queued by
    // call identity. When one of two calls with the same identity takes the
    // entry recorded at step 1, the other starts its child at step 1 over it.
    const original = recorded(1, 'call-a')
    const recorder = createJournalRecorder(DIGEST, { scriptDigest: DIGEST, entries: [original] })

    recorder.stepStarted({ seq: 1, label: 'review', childId: 'child-2', call: 'call-a' }, 'side-effecting')

    expect(recorder.journal().entries[0]?.childReceipts).toStrictEqual(['child-2'])
    expect(recorder.journal().displaced).toStrictEqual([original])
  })

  it('replaces an unverified entry of the same call at its step number, which is that step running again', () => {
    const original: JournalEntry = { ...recorded(1, 'call-a'), verified: false }
    const recorder = createJournalRecorder(DIGEST, { scriptDigest: DIGEST, entries: [original] })

    recorder.stepStarted({ seq: 1, label: 'review', childId: 'child-2', call: 'call-a' }, 'side-effecting')

    expect(recorder.journal().entries[0]?.childReceipts).toStrictEqual(['child-2'])
    expect(recorder.journal().displaced).toBeUndefined()
  })

  it('keeps displaced entries, receipts and all, through compaction', () => {
    const journal: WorkflowJournal = { scriptDigest: DIGEST, entries: [recorded(1, 'call-b')], displaced: [recorded(1, 'call-a')] }

    const compacted = compactJournal(journal)

    expect(compacted.displaced).toStrictEqual(journal.displaced)
    expect(retainsAllReceipts(journal, compacted)).toBe(true)
  })
})
