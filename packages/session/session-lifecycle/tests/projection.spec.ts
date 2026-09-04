/**
 * Epic P6-07 Usage stage: the join that turns
 * `@deepseek-ai/dsh-session-query`'s real live-preferred session corpus into
 * the lifecycle records `listSessions` pages over (must[0]).
 *
 * Every assertion is on a projected record or a returned id. Nothing here
 * touches a filesystem, so no case can be true on one platform and false on
 * another.
 */

import { describe, expect, it } from 'vitest'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { listSessions, projectLifecycleRecords } from '@deepseek-ai/dsh-session-lifecycle'
import type { SessionLifecycleRecord } from '@deepseek-ai/dsh-session-lifecycle'

const ACME = TenantId('acme')
const GLOBEX = TenantId('globex')
const AUDITOR = PrincipalId('auditor')
const WORKSPACE_A = WorkspaceId('workspace-a')

function header(value: string, createdAt = 1): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(value), createdAt, isSeeded: false }
}

function corpusRecord(value: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { header: header(value), live: true, persisted: false, ...extra }
}

function registry(...records: readonly SessionLifecycleRecord[]): ReadonlyMap<SessionIdType, SessionLifecycleRecord> {
  return new Map(records.map(record => [record.header.id, record]))
}

describe('projectLifecycleRecords (P6-07 must[0])', () => {
  it('projects an unregistered corpus session as active under its observed tenant', () => {
    const projection = projectLifecycleRecords([corpusRecord('fresh', { tenantId: ACME })], registry())
    expect(projection.records).toStrictEqual([{
      header: header('fresh'),
      tenantId: ACME,
      disposition: { kind: 'active' },
    }])
    expect(projection.unattributed).toStrictEqual([])
  })

  it('carries an observed workspaceId through, and omits the property when the corpus observed none', () => {
    const projection = projectLifecycleRecords([
      corpusRecord('in-workspace', { tenantId: ACME, workspaceId: WORKSPACE_A }),
      corpusRecord('no-workspace', { tenantId: ACME }),
    ], registry())
    expect(projection.records[0]?.workspaceId).toBe(WORKSPACE_A)
    expect(projection.records[1]).not.toHaveProperty('workspaceId')
  })

  it('keeps a registered record\'s durable disposition rather than projecting it back to active', () => {
    const durable: SessionLifecycleRecord = {
      header: header('deleted'),
      tenantId: ACME,
      disposition: { kind: 'soft-deleted', deletedAt: 500, deletedBy: AUDITOR },
    }
    const projection = projectLifecycleRecords(
      [corpusRecord('deleted', { tenantId: GLOBEX })],
      registry(durable),
    )
    expect(projection.records).toStrictEqual([durable])
  })

  it('keeps a registered record\'s legal hold, which a corpus observation can never clear', () => {
    const held: SessionLifecycleRecord = {
      header: header('held'),
      tenantId: ACME,
      disposition: { kind: 'active' },
      legalHold: { heldAt: 700, heldBy: AUDITOR, reason: 'litigation pending' },
    }
    const projection = projectLifecycleRecords([corpusRecord('held', { tenantId: ACME })], registry(held))
    expect(projection.records[0]?.legalHold).toStrictEqual(held.legalHold)
  })

  it('reports an unregistered, tenant-less corpus session as unattributed and emits no record for it', () => {
    const projection = projectLifecycleRecords([
      corpusRecord('anonymous'),
      corpusRecord('attributed', { tenantId: ACME }),
    ], registry())
    expect(projection.records.map(record => record.header.id)).toStrictEqual([SessionId('attributed')])
    expect(projection.unattributed).toStrictEqual([SessionId('anonymous')])
  })

  it('projects a registered session even when the corpus observed no tenant for it', () => {
    const durable: SessionLifecycleRecord = {
      header: header('registered-anonymous'),
      tenantId: ACME,
      disposition: { kind: 'archived', archivedAt: 42, archivedBy: AUDITOR },
    }
    const projection = projectLifecycleRecords([corpusRecord('registered-anonymous')], registry(durable))
    expect(projection.records).toStrictEqual([durable])
    expect(projection.unattributed).toStrictEqual([])
  })

  it('preserves the corpus listing order', () => {
    const ids = ['third', 'first', 'second']
    const projection = projectLifecycleRecords(
      ids.map(value => corpusRecord(value, { tenantId: ACME })),
      registry(),
    )
    expect(projection.records.map(record => record.header.id)).toStrictEqual(ids.map(value => SessionId(value)))
  })

  it('feeds listSessions, so a tenant-filtered page walk over the real corpus omits and duplicates nothing', () => {
    const corpus = [
      corpusRecord('a', { tenantId: ACME }),
      corpusRecord('b', { tenantId: GLOBEX }),
      corpusRecord('c', { tenantId: ACME }),
      corpusRecord('d', { tenantId: ACME }),
      corpusRecord('e'),
    ]
    const { records } = projectLifecycleRecords(corpus, registry())

    const seen: SessionIdType[] = []
    let cursor = listSessions(records, { filters: [{ kind: 'tenant', values: [ACME] }], limit: 2 })
    seen.push(...cursor.items.map(record => record.header.id))
    while (cursor.nextCursor !== undefined) {
      cursor = listSessions(records, {
        filters: [{ kind: 'tenant', values: [ACME] }],
        limit: 2,
        cursor: cursor.nextCursor,
      })
      seen.push(...cursor.items.map(record => record.header.id))
    }
    expect(seen).toStrictEqual([SessionId('a'), SessionId('c'), SessionId('d')])
  })

  it('feeds a status-filtered listing, so a soft-deleted session is excluded from an active listing', () => {
    const durable: SessionLifecycleRecord = {
      header: header('gone'),
      tenantId: ACME,
      disposition: { kind: 'soft-deleted', deletedAt: 9, deletedBy: AUDITOR },
    }
    const { records } = projectLifecycleRecords([
      corpusRecord('gone', { tenantId: ACME }),
      corpusRecord('here', { tenantId: ACME }),
    ], registry(durable))

    const active = listSessions(records, { filters: [{ kind: 'status', values: ['active'] }] })
    expect(active.items.map(record => record.header.id)).toStrictEqual([SessionId('here')])
  })
})
