/**
 * Epic P2-07 U2: what one workflow `approval()` call resolves to on the host.
 * A new call records a run-scoped approval and waits; a call the journal has
 * seen reads its approval as the viewer journaled with it and consumes it by
 * compare-and-swap, so of two runs resuming one waiting run at most one
 * continues (acceptance[1]).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ApprovalRequestId, ApprovalStoreContract, ApprovalViewer, PrincipalId, TenantId } from '@deepseek-ai/dsh-approval-store'
import { openApprovalStore, type OpenedApprovalStore } from '@deepseek-ai/dsh-approval-store/sqlite'
import { createJournalRecorder, type JournaledStart, type ScriptDigest } from '@deepseek-ai/dsh-workflow-journal'
import { answerApproval, type ApprovalAsk } from '../src/approvals.ts'

const dirs: string[] = []
const stores: OpenedApprovalStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fresh SQLite approval store, closed after the case. */
function store(): OpenedApprovalStore {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-workflow-approval-'))
  dirs.push(dir)
  const opened = openApprovalStore(dir, { busyTimeoutMs: 1000 })
  stores.push(opened)
  return opened
}

const start: JournaledStart = { session: 'run-session', script: 'return 1', meta: { name: 'ship', description: 'ships', phases: [] }, route: {} }
const tenantA = brandString<TenantId>('tenant-a')
const runViewer: ApprovalViewer = { tenant: tenantA, principal: brandString<PrincipalId>('agent:run-session') }
const operator: ApprovalViewer = { tenant: tenantA, principal: brandString<PrincipalId>('operator') }

/**
 * One `approval()` call of run `run-1`.
 * @param overrides - fields that differ from the default call.
 * @returns the call.
 */
function ask(overrides: Partial<ApprovalAsk> = {}): ApprovalAsk {
  return { key: 'abc:1', title: 'ship it', runId: 'run-1', workflowName: 'ship', start, viewer: runViewer, waitMs: 60_000, nowMs: Date.now(), ...overrides }
}

/** A recorder for one run's journal. */
function journal(): ReturnType<typeof createJournalRecorder> {
  return createJournalRecorder(brandString<ScriptDigest>('digest'))
}

describe('P2-07 U2: an approval() call nobody has decided', () => {
  it('records a run-scoped approval as the run session\'s viewer, journals it with what the run was started with, and waits', () => {
    const approvals = store()
    const recorder = journal()
    const answer = answerApproval(approvals, recorder, ask())
    expect(answer.kind).toBe('wait')
    const id = brandString<ApprovalRequestId>((answer as { approvalId: string }).approvalId)
    expect(approvals.get(id, operator, Date.now())).toMatchObject({
      state: 'requested',
      tenant: 'tenant-a',
      actor: 'agent:run-session',
      scope: { kind: 'run', runId: 'run-1', sessionId: 'run-session' },
      toolName: 'workflow ship: ship it',
      requestDigest: 'sha256:abc',
    })
    expect(recorder.journal()).toMatchObject({
      start,
      approvals: [{ key: 'abc:1', approvalId: id, tenant: 'tenant-a', principal: 'agent:run-session', state: 'waiting' }],
    })
    expect(answerApproval(approvals, recorder, ask()).kind).toBe('wait')
  })

  it('cannot wait in a run that is not detached, or where no approval store is mounted', () => {
    expect(answerApproval(store(), journal(), ask({ start: undefined }))).toMatchObject({ kind: 'unavailable', rendered: expect.stringContaining('detached run') as string })
    expect(answerApproval(undefined, journal(), ask())).toMatchObject({ kind: 'unavailable', rendered: expect.stringContaining('approval store') as string })
  })
})

describe('P2-07 U2: an approval() call whose approval was decided', () => {
  it('consumes an approved approval once, so of two runs resuming one waiting run only one continues (acceptance[1])', () => {
    const approvals = store()
    const first = journal()
    const answer = answerApproval(approvals, first, ask())
    const id = brandString<ApprovalRequestId>((answer as { approvalId: string }).approvalId)
    approvals.decide(id, 0, 'approved', operator, Date.now())
    const seed = first.journal()
    const resumedA = createJournalRecorder(brandString<ScriptDigest>('digest'), seed)
    const resumedB = createJournalRecorder(brandString<ScriptDigest>('digest'), seed)

    expect(answerApproval(approvals, resumedA, ask())).toEqual({ kind: 'granted' })
    expect(answerApproval(approvals, resumedB, ask())).toEqual({ kind: 'refused', approvalId: id, refusal: 'consumed' })
    expect(approvals.get(id, operator, Date.now())?.state).toBe('consumed')
    expect(resumedA.approvalFor('abc:1')?.state).toBe('consumed')
    // A re-run of the run that consumed it passes the same call without consuming again.
    expect(answerApproval(approvals, resumedA, ask())).toEqual({ kind: 'granted' })
  })

  it('reads and consumes as the viewer the run journaled, not as the resuming process (D2)', () => {
    const approvals = store()
    const recorder = journal()
    const answer = answerApproval(approvals, recorder, ask())
    const id = brandString<ApprovalRequestId>((answer as { approvalId: string }).approvalId)
    approvals.decide(id, 0, 'approved', operator, Date.now())
    const elsewhere: ApprovalViewer = { tenant: brandString<TenantId>('tenant-b'), principal: brandString<PrincipalId>('someone-else') }

    expect(answerApproval(approvals, recorder, ask({ viewer: elsewhere }))).toEqual({ kind: 'granted' })
    expect(approvals.get(id, operator, Date.now())).toMatchObject({ state: 'consumed', decidedBy: 'operator' })
  })

  it('refuses a denied, revoked, lapsed or missing approval, naming how it ended', () => {
    for (const [move, refusal] of [['denied', 'denied'], ['revoked', 'revoked'], ['lapsed', 'expired'], ['missing', 'revoked']] as const) {
      const approvals = store()
      const recorder = journal()
      const answer = answerApproval(approvals, recorder, ask({ waitMs: move === 'lapsed' ? 1 : 60_000 }))
      const id = brandString<ApprovalRequestId>((answer as { approvalId: string }).approvalId)
      if (move === 'denied') approvals.decide(id, 0, 'denied', operator, Date.now())
      if (move === 'revoked') approvals.revoke(id, 0, operator, Date.now())
      const later = move === 'lapsed' ? Date.now() + 10 : Date.now()
      const source: ApprovalStoreContract = move === 'missing' ? store() : approvals
      expect([move, answerApproval(source, recorder, ask({ nowMs: later }))]).toEqual([move, { kind: 'refused', approvalId: id, refusal }])
    }
  })

  it('refuses when its consumption loses to another writer, from what the store then holds', () => {
    const recorder = journal()
    recorder.approvalRecorded({ key: 'abc:1', approvalId: 'a-1', tenant: 'tenant-a', principal: 'agent:run-session', state: 'waiting' }, start)
    const approved = { state: 'approved', revision: 1 }
    const losing = (current: unknown): ApprovalStoreContract => ({
      get: () => approved,
      consume: () => ({ ok: false, conflict: 'stale-revision', current }),
    }) as unknown as ApprovalStoreContract
    expect(answerApproval(losing({ state: 'approved' }), recorder, ask())).toMatchObject({ kind: 'refused', refusal: 'consumed' })
    expect(answerApproval(losing({ state: 'requested' }), recorder, ask())).toMatchObject({ kind: 'refused', refusal: 'consumed' })
    expect(answerApproval(losing({ state: 'revoked' }), recorder, ask())).toMatchObject({ kind: 'refused', refusal: 'revoked' })
    expect(answerApproval(losing(undefined), recorder, ask())).toMatchObject({ kind: 'refused', refusal: 'expired' })
  })
})
