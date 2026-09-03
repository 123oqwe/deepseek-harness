/**
 * Provider stage for Epic P6-07's durable session-lifecycle
 * registry (`../src/store.ts`): the half this package's Contract stage cannot
 * reach.
 *
 * `../src/index.ts`'s `listSessions` and `../src/retention.ts`/`../src/delete.ts`'s
 * `archiveSession`, `softDeleteSession`,
 * `placeLegalHold`, `assertNoLegalHold`, `propagateDeletion` and `hardErase`
 * are pure functions over a `SessionLifecycleRecord[]` some caller already
 * holds. Nothing produces that array and nothing persists a disposition
 * change, so a soft delete, an archive, or a legal hold is today a value
 * returned to a caller and then lost at process exit. Every case below
 * therefore constructs a SECOND store instance and a SECOND service over the
 * same path, sharing no map, closure, or record value with the first — so a
 * record that reappears came from durable bytes and nothing else, and an
 * in-memory double cannot pass.
 *
 * `createFileSessionLifecycleStore` and `SessionLifecycleService` do not exist
 * yet in `../src/store.ts`, so every case fails on that today; the assertions
 * describe the behavior the GREEN round must satisfy.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { ArtifactRef, LegalHoldBlocksErasureError, MemoryRef } from '../src/index.ts'
import type { SessionDependents, SessionLifecycleRecord } from '../src/index.ts'
import { SessionLifecycleService, createFileSessionLifecycleStore } from '../src/store.ts'

/** Deterministic timestamp fixtures build with, so every stamped value is comparable. */
const FIXED_TIME = 1_700_000_000_000

const ACTOR = PrincipalId('actor-1')
const TENANT_A = TenantId('tenant-a')
const TENANT_B = TenantId('tenant-b')
const WORKSPACE_A = WorkspaceId('workspace-a')
const WORKSPACE_B = WorkspaceId('workspace-b')

/** Every temporary store directory this file created, removed after each case. */
const directories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

/** Allocate one fresh store path no other case shares. */
async function storePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-store-'))
  directories.push(directory)
  return join(directory, 'lifecycle.json')
}

/** Build a minimal, real {@link SessionHeader}. */
function fixtureHeader(id: SessionId, createdAt: number): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id, createdAt, isSeeded: false }
}

/** Build a real, `active`-disposition {@link SessionLifecycleRecord}. */
function fixtureRecord(
  id: string,
  createdAt: number,
  tenantId = TENANT_A,
  workspaceId = WORKSPACE_A,
): SessionLifecycleRecord {
  return {
    header: fixtureHeader(SessionId(id), createdAt),
    tenantId,
    workspaceId,
    disposition: { kind: 'active' },
  }
}

/** Build a real dependent-store inventory for `id`, non-empty in all three id-bearing kinds. */
function fixtureDependents(id: string): SessionDependents {
  return {
    sessionId: SessionId(id),
    attachmentIds: [AttachmentId(`${id}-attachment`)],
    memoryRefs: [MemoryRef(`${id}-memory`)],
    artifactRefs: [ArtifactRef(`${id}-artifact`)],
  }
}

/**
 * Simulate a process restart: a brand-new store and a brand-new service over
 * `path`, sharing nothing with any earlier instance but the file itself.
 */
async function restart(path: string): Promise<SessionLifecycleService> {
  return SessionLifecycleService.restore(createFileSessionLifecycleStore(path))
}

describe('durable session-lifecycle registry (acceptance[0]: listing survives a restart)', () => {
  it('lists a lifecycle record reconstructed from the durable store by a fresh service', async () => {
    const path = await storePath()
    const first = await restart(path)
    await first.register(fixtureRecord('session-1', FIXED_TIME))

    const second = await restart(path)
    expect(second.list({}).items.map(record => String(record.header.id))).toStrictEqual(['session-1'])
  })

  it('walks every page of a restored listing, visiting each durable record exactly once with no omission or duplication', async () => {
    const path = await storePath()
    const writer = await restart(path)
    for (let index = 0; index < 64; index += 1) {
      await writer.register(fixtureRecord(`session-${String(index).padStart(3, '0')}`, FIXED_TIME + index))
    }

    const reader = await restart(path)
    const visited: string[] = []
    let cursor = undefined
    do {
      const page = reader.list({ limit: 7, ...cursor === undefined ? {} : { cursor } })
      visited.push(...page.items.map(record => String(record.header.id)))
      cursor = page.nextCursor
    } while (cursor !== undefined)

    const expected = Array.from({ length: 64 }, (_, index) => `session-${String(index).padStart(3, '0')}`)
    expect(visited).toStrictEqual(expected)
    expect(new Set(visited).size).toBe(64)
  })

  it('starts empty on a first boot, with no store file on disk yet', async () => {
    const path = await storePath()
    const service = await restart(path)
    expect(service.list({}).items).toStrictEqual([])
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reads back exactly what a separate store instance over the same path wrote, brands included', async () => {
    const path = await storePath()
    const record = fixtureRecord('session-1', FIXED_TIME)
    await createFileSessionLifecycleStore(path).put(record)

    expect(await createFileSessionLifecycleStore(path).loadAll()).toStrictEqual([record])
  })
})

describe('durable filtering (must[0]: tenant/workspace/status/time filters over stored records)', () => {
  it('filters a restored listing by tenant, excluding another tenant\'s record', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-a', FIXED_TIME, TENANT_A))
    await writer.register(fixtureRecord('session-b', FIXED_TIME + 1, TENANT_B))

    const reader = await restart(path)
    const items = reader.list({ filters: [{ kind: 'tenant', values: [TENANT_A] }] }).items
    expect(items.map(record => String(record.header.id))).toStrictEqual(['session-a'])
  })

  it('filters a restored listing by workspace', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-a', FIXED_TIME, TENANT_A, WORKSPACE_A))
    await writer.register(fixtureRecord('session-b', FIXED_TIME + 1, TENANT_A, WORKSPACE_B))

    const reader = await restart(path)
    const items = reader.list({ filters: [{ kind: 'workspace', values: [WORKSPACE_B] }] }).items
    expect(items.map(record => String(record.header.id))).toStrictEqual(['session-b'])
  })

  it('filters a restored listing by status, excluding a soft-deleted record from an active-only page', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-a', FIXED_TIME))
    await writer.register(fixtureRecord('session-b', FIXED_TIME + 1))
    await writer.softDelete(SessionId('session-b'), ACTOR, FIXED_TIME + 2, fixtureDependents('session-b'))

    const reader = await restart(path)
    const items = reader.list({ filters: [{ kind: 'status', values: ['active'] }] }).items
    expect(items.map(record => String(record.header.id))).toStrictEqual(['session-a'])
  })

  it('filters a restored listing by time range', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-early', FIXED_TIME))
    await writer.register(fixtureRecord('session-late', FIXED_TIME + 1_000))

    const reader = await restart(path)
    const items = reader.list({ filters: [{ kind: 'time', from: FIXED_TIME + 500 }] }).items
    expect(items.map(record => String(record.header.id))).toStrictEqual(['session-late'])
  })
})

describe('durable dispositions (must[1]: archive and soft delete are separately persisted states)', () => {
  it('persists an archive so a fresh service reads back the archived disposition, not the active one', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-1', FIXED_TIME))
    await writer.archive(SessionId('session-1'), ACTOR, FIXED_TIME + 5)

    const reader = await restart(path)
    expect(reader.get(SessionId('session-1'))?.disposition).toStrictEqual({
      kind: 'archived',
      archivedAt: FIXED_TIME + 5,
      archivedBy: ACTOR,
    })
  })

  it('persists a soft delete so a fresh service reads back the soft-deleted disposition', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-1', FIXED_TIME))
    await writer.softDelete(SessionId('session-1'), ACTOR, FIXED_TIME + 5, fixtureDependents('session-1'))

    const reader = await restart(path)
    expect(reader.get(SessionId('session-1'))?.disposition).toStrictEqual({
      kind: 'soft-deleted',
      deletedAt: FIXED_TIME + 5,
      deletedBy: ACTOR,
    })
  })

  it('keeps archive and soft delete separate: an archived record is never listed under a soft-deleted status filter', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-archived', FIXED_TIME))
    await writer.register(fixtureRecord('session-deleted', FIXED_TIME + 1))
    await writer.archive(SessionId('session-archived'), ACTOR, FIXED_TIME + 5)
    await writer.softDelete(SessionId('session-deleted'), ACTOR, FIXED_TIME + 6, fixtureDependents('session-deleted'))

    const reader = await restart(path)
    expect(reader.list({ filters: [{ kind: 'status', values: ['soft-deleted'] }] }).items
      .map(record => String(record.header.id))).toStrictEqual(['session-deleted'])
    expect(reader.list({ filters: [{ kind: 'status', values: ['archived'] }] }).items
      .map(record => String(record.header.id))).toStrictEqual(['session-archived'])
  })
})

describe('durable legal hold (acceptance[1]: a hold survives a restart and still blocks hard erase)', () => {
  it('persists a legal hold so a fresh service still refuses to hard-erase after a restart', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-1', FIXED_TIME))
    await writer.placeHold(SessionId('session-1'), ACTOR, 'litigation-42', FIXED_TIME + 5)

    const reader = await restart(path)
    await expect(reader.erase(SessionId('session-1'), fixtureDependents('session-1'), FIXED_TIME + 9))
      .rejects.toBeInstanceOf(LegalHoldBlocksErasureError)
  })

  it('leaves a held record durably intact after a refused erase, rather than partially destroying it', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-1', FIXED_TIME))
    await writer.placeHold(SessionId('session-1'), ACTOR, 'litigation-42', FIXED_TIME + 5)
    const held = (await restart(path)).get(SessionId('session-1'))

    const attempt = await restart(path)
    await expect(attempt.erase(SessionId('session-1'), fixtureDependents('session-1'), FIXED_TIME + 9))
      .rejects.toBeInstanceOf(LegalHoldBlocksErasureError)

    expect((await restart(path)).get(SessionId('session-1'))).toStrictEqual(held)
  })

  it('carries a legal hold alongside a soft-deleted disposition across a restart', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-1', FIXED_TIME))
    await writer.softDelete(SessionId('session-1'), ACTOR, FIXED_TIME + 5, fixtureDependents('session-1'))
    await writer.placeHold(SessionId('session-1'), ACTOR, 'litigation-42', FIXED_TIME + 6)

    const restored = (await restart(path)).get(SessionId('session-1'))
    expect(restored?.disposition).toStrictEqual({ kind: 'soft-deleted', deletedAt: FIXED_TIME + 5, deletedBy: ACTOR })
    expect(restored?.legalHold).toStrictEqual({ heldAt: FIXED_TIME + 6, heldBy: ACTOR, reason: 'litigation-42' })
  })
})

describe('durable deletion propagation (must[2]/acceptance[2]: an authorized erase propagates and does not come back)', () => {
  it('propagates an authorized erase to all four dependent stores and removes the record durably', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-1', FIXED_TIME))

    const result = await writer.erase(SessionId('session-1'), fixtureDependents('session-1'), FIXED_TIME + 9)
    expect(result.erasedAt).toBe(FIXED_TIME + 9)
    expect(result.propagation.targets).toStrictEqual([
      { kind: 'query-index', action: 'destroy', sessionId: SessionId('session-1') },
      { kind: 'attachments', action: 'destroy', attachmentIds: [AttachmentId('session-1-attachment')] },
      { kind: 'memory', action: 'destroy', memoryRefs: [MemoryRef('session-1-memory')] },
      { kind: 'artifacts', action: 'destroy', artifactRefs: [ArtifactRef('session-1-artifact')] },
    ])
  })

  it('propagates a soft delete to the query index only, leaving attachments, memory and artifacts untouched', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-1', FIXED_TIME))

    const outcome = await writer.softDelete(SessionId('session-1'), ACTOR, FIXED_TIME + 5, fixtureDependents('session-1'))
    expect(outcome.propagation.targets).toStrictEqual([
      { kind: 'query-index', action: 'hide', sessionId: SessionId('session-1') },
    ])
  })

  it('does not resurrect an erased record for a fresh service over the same path', async () => {
    const path = await storePath()
    const writer = await restart(path)
    await writer.register(fixtureRecord('session-kept', FIXED_TIME))
    await writer.register(fixtureRecord('session-erased', FIXED_TIME + 1))
    await writer.erase(SessionId('session-erased'), fixtureDependents('session-erased'), FIXED_TIME + 9)

    const reader = await restart(path)
    expect(reader.get(SessionId('session-erased'))).toBeUndefined()
    expect(reader.list({}).items.map(record => String(record.header.id))).toStrictEqual(['session-kept'])
  })
})

describe('store document integrity (a document this build cannot interpret is refused, never misread)', () => {
  it('refuses a store document written under an unsupported format version instead of reading it as empty', async () => {
    const path = await storePath()
    await writeFile(path, `${JSON.stringify({ version: 99, records: [] })}\n`, 'utf8')

    await expect(restart(path)).rejects.toThrow(/unsupported session lifecycle store format version 99/)
  })
})
