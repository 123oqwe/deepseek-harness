/**
 * The SQLite approval store (Epic P2-07 Provider) on a real file: every
 * contract operation, two connections deciding one approval, a reopen, the
 * schema-version refusal, tenancy, deadlines, the rollback at each fault
 * point, and the plugin that publishes it as `ctx.approvalStore`.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import ApprovalStoreSqlitePlugin, { openApprovalStore, type ApprovalStoreFaultPoint, type OpenedApprovalStore } from '../src/sqlite.ts'
import type { ApprovalRequestId, ApprovalRequestInput, ApprovalViewer, PrincipalId, RunId, SessionId, TenantId } from '../src/index.ts'

const dirs: string[] = []
const opened: OpenedApprovalStore[] = []
afterEach(() => {
  for (const store of opened.splice(0)) store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fresh directory, removed after the case. */
function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-approval-store-'))
  dirs.push(dir)
  return dir
}

/**
 * Open a store the case closes afterwards.
 * @param dir - the store's directory.
 * @param fault - the fault hook, if any.
 * @returns the opened store.
 */
function open(dir: string, fault?: (point: ApprovalStoreFaultPoint) => void): OpenedApprovalStore {
  const store = openApprovalStore(dir, { busyTimeoutMs: 1000, ...fault === undefined ? {} : { fault } })
  opened.push(store)
  return store
}

const tenant = brandString<TenantId>('tenant-a')
const sessionId = brandString<SessionId>('session-1')
const user: ApprovalViewer = { tenant, principal: brandString<PrincipalId>('user-1') }
const otherUser: ApprovalViewer = { tenant, principal: brandString<PrincipalId>('user-2') }
const otherTenant: ApprovalViewer = { tenant: brandString<TenantId>('tenant-b'), principal: brandString<PrincipalId>('user-3') }
const id = (value: string): ApprovalRequestId => brandString<ApprovalRequestId>(value)

/**
 * A turn-scoped request with every optional field set.
 * @param value - the approval id.
 * @param deadlineMs - its deadline.
 * @returns the request input.
 */
function input(value: string, deadlineMs = 10_000): ApprovalRequestInput {
  return {
    id: id(value),
    tenant,
    actor: brandString<PrincipalId>('agent-1'),
    scope: { kind: 'turn', sessionId, callId: 'call-1' },
    toolName: 'bash',
    requestDigest: `sha256:${value}`,
    policyVersion: 'policy-1',
    deadlineMs,
  }
}

describe('the SQLite approval store (P2-07 P)', () => {
  it('reads back what it recorded, for a turn and a run scope, with absent fields absent', () => {
    const store = open(directory())
    const turn = store.request(input('a-1'), 100)
    expect(store.get(id('a-1'), user, 200)).toEqual(turn)
    const run = store.request({ ...input('a-2'), scope: { kind: 'run', runId: brandString<RunId>('run-1'), sessionId } }, 100)
    expect(store.get(id('a-2'), user, 200)).toEqual(run)
    const bare: ApprovalRequestInput = {
      id: id('a-3'), tenant, actor: brandString<PrincipalId>('agent-1'), scope: { kind: 'turn', sessionId }, toolName: 'read', requestDigest: 'sha256:a-3', deadlineMs: 10_000,
    }
    expect(store.get(store.request(bare, 100).id, user, 200)).toStrictEqual({ ...bare, state: 'requested', revision: 0, requestedAtMs: 100 })
  })

  it('decides, revokes and consumes by one compare-and-swap each, and consumes at most once', () => {
    const store = open(directory())
    store.request(input('a-1'), 100)
    const approved = store.decide(id('a-1'), 0, 'approved', user, 200)
    expect(approved).toMatchObject({ ok: true, record: { state: 'approved', revision: 1, decidedBy: user.principal, decidedAtMs: 200 } })
    expect(store.consume(id('a-1'), 1, otherUser, 300)).toMatchObject({ ok: true, record: { state: 'consumed', revision: 2, consumedAtMs: 300 } })
    expect(store.consume(id('a-1'), 1, otherUser, 301)).toMatchObject({ ok: false, conflict: 'stale-revision', current: { state: 'consumed' } })
    expect(store.consume(id('a-1'), 2, otherUser, 302)).toMatchObject({ ok: false, conflict: 'invalid-transition' })
    store.request(input('a-2'), 100)
    expect(store.revoke(id('a-2'), 0, otherUser, 250)).toMatchObject({ ok: true, record: { state: 'revoked', decidedBy: otherUser.principal } })
    expect(store.get(id('a-1'), user, 400)).toMatchObject({ state: 'consumed', revision: 2, decidedBy: user.principal, consumedAtMs: 300 })
    expect(store.decide(id('missing'), 0, 'approved', user, 200)).toEqual({ ok: false, conflict: 'not-found' })
  })

  it('leaves one terminal state when two connections decide from the same read', () => {
    const dir = directory()
    const a = open(dir)
    const b = open(dir)
    a.request(input('a-1'), 100)
    const readA = a.get(id('a-1'), user, 150)
    const readB = b.get(id('a-1'), otherUser, 150)
    expect(a.decide(id('a-1'), readA?.revision ?? -1, 'approved', user, 200)).toMatchObject({ ok: true })
    expect(b.decide(id('a-1'), readB?.revision ?? -1, 'denied', otherUser, 201))
      .toMatchObject({ ok: false, conflict: 'stale-revision', current: { state: 'approved', revision: 1 } })
    expect(open(dir).get(id('a-1'), user, 300)).toMatchObject({ state: 'approved', decidedBy: user.principal })
  })

  it('keeps every approval across a reopen', () => {
    const dir = directory()
    const recorded = open(dir).request(input('a-1'), 100)
    expect(open(dir).get(id('a-1'), user, 200)).toEqual(recorded)
  })

  it('refuses a file written at another schema version rather than read it', () => {
    const dir = directory()
    open(dir)
    const raw = new DatabaseSync(join(dir, 'approvals.sqlite'))
    raw.exec('UPDATE schema_version SET version = 2 WHERE singleton = 1')
    raw.close()
    expect(() => openApprovalStore(dir, { busyTimeoutMs: 1000 })).toThrow(/schema version 2, not 1/u)
  })

  it('shows another tenant nothing and lets it decide nothing', () => {
    const store = open(directory())
    store.request(input('a-1'), 100)
    expect(store.get(id('a-1'), otherTenant, 200)).toBeUndefined()
    expect(store.listPending(otherTenant, 200)).toEqual([])
    expect(store.decide(id('a-1'), 0, 'approved', otherTenant, 200)).toEqual({ ok: false, conflict: 'other-tenant' })
  })

  it('lists the tenant\'s pending approvals oldest first, without lapsed or decided ones', () => {
    const store = open(directory())
    store.request(input('a-1'), 100)
    store.request(input('a-2', 300), 200)
    store.request(input('a-3'), 300)
    store.decide(id('a-3'), 0, 'approved', user, 310)
    store.request(input('a-4'), 350)
    store.decide(id('a-4'), 0, 'denied', user, 360)
    expect(store.listPending(user, 400).map(record => record.id)).toEqual(['a-1', 'a-3'])
  })

  it('reads a lapsed approval as expired and refuses to consume it', () => {
    const store = open(directory())
    store.request(input('a-1', 1_000), 100)
    store.decide(id('a-1'), 0, 'approved', user, 200)
    expect(store.get(id('a-1'), user, 999)).toMatchObject({ state: 'approved' })
    expect(store.get(id('a-1'), user, 1_000)).toMatchObject({ state: 'expired', revision: 1 })
    expect(store.consume(id('a-1'), 1, user, 1_000)).toMatchObject({ ok: false, conflict: 'expired' })
  })

  it('rolls a write back when it fails inside its transaction, at either fault point', () => {
    let armed: ApprovalStoreFaultPoint | undefined
    const store = open(directory(), (point) => {
      if (point === armed) throw new Error(`injected fault ${point}`)
    })
    armed = 'after-insert'
    expect(() => store.request(input('a-1'), 100)).toThrow('injected fault after-insert')
    expect(store.get(id('a-1'), user, 200)).toBeUndefined()
    armed = undefined
    store.request(input('a-2'), 100)
    armed = 'after-update'
    expect(() => store.decide(id('a-2'), 0, 'approved', user, 200)).toThrow('injected fault after-update')
    expect(store.get(id('a-2'), user, 300)).toMatchObject({ state: 'requested', revision: 0 })
  })
})

describe('ApprovalStoreSqlitePlugin', () => {
  it('publishes the store as ctx.approvalStore while mounted, and refuses calls once unloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalStoreSqlitePlugin, { directory: directory(), busyTimeoutMs: 1000 })
    const store = ctx.get('approvalStore')
    if (store === undefined) throw new Error('ctx.approvalStore is not published')
    store.request(input('a-1'), 100)
    store.request(input('a-2'), 100)
    expect(store.decide(id('a-1'), 0, 'approved', user, 200)).toMatchObject({ ok: true })
    expect(store.consume(id('a-1'), 1, user, 300)).toMatchObject({ ok: true })
    expect(store.revoke(id('a-2'), 0, user, 300)).toMatchObject({ ok: true })
    expect(store.get(id('a-1'), user, 400)).toMatchObject({ state: 'consumed' })
    expect(store.listPending(user, 400)).toEqual([])
    await ctx.fiber.dispose()
    expect(() => store.listPending(user, 500)).toThrow('approval store: the mount is not active')
  })

  it('announces each recorded approval and each accepted move, and no refused one (U1c)', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalStoreSqlitePlugin, { directory: directory(), busyTimeoutMs: 1000 })
    const announced: string[] = []
    ctx.on('approval-store/changed', (record) => { announced.push(`${record.id}:${record.state}:${record.revision}`) })
    const store = ctx.get('approvalStore')
    if (store === undefined) throw new Error('ctx.approvalStore is not published')
    store.request(input('a-1'), 100)
    store.request(input('a-2'), 100)
    store.decide(id('a-1'), 0, 'approved', user, 200)
    store.decide(id('a-1'), 0, 'denied', otherUser, 200)
    store.consume(id('a-1'), 1, user, 300)
    store.consume(id('a-1'), 2, user, 300)
    store.revoke(id('a-2'), 0, user, 300)
    store.revoke(id('a-2'), 0, otherTenant, 300)
    expect(announced).toEqual(['a-1:requested:0', 'a-2:requested:0', 'a-1:approved:1', 'a-1:consumed:2', 'a-2:revoked:1'])
    await ctx.fiber.dispose()
  })
})
