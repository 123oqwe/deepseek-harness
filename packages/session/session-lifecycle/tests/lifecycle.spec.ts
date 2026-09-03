/**
 * Contract-stage RED scaffold for Epic P6-07's session lifecycle: pagination
 * and filtering (must[0]/acceptance[0]), the soft-delete/legal-hold/
 * hard-erase/archive taxonomy (must[1]/acceptance[1]), deletion propagation
 * (must[2]/acceptance[2]), and corrupted-log partial recovery
 * (acceptance[3]).
 *
 * Every case below calls a real exported function against real branded
 * fixture data; every function under test currently throws
 * `'not implemented: ...'` (`../src/retention.ts`, `../src/delete.ts`,
 * `../src/index.ts`), so every case fails for that reason today — the
 * assertions themselves describe the behavior a later fix-round must
 * satisfy.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  ArtifactRef,
  HARD_ERASE_POLICY,
  LegalHoldBlocksErasureError,
  MemoryRef,
  SOFT_DELETE_POLICY,
  archiveSession,
  assertNoLegalHold,
  hardErase,
  listSessions,
  placeLegalHold,
  propagateDeletion,
  readSessionLogWithRepair,
  softDeleteSession,
} from '../src/index.ts'
import type {
  LegalHold,
  RawSessionLogLine,
  SessionDependents,
  SessionDisposition,
  SessionLifecycleCursor,
  SessionLifecycleRecord,
} from '../src/index.ts'

/** Deterministic timestamp fixtures build with, so construction stays pure and comparable. */
const FIXED_TIME = 1_700_000_000_000

const ACTOR = PrincipalId('actor-1')
const TENANT_A = TenantId('tenant-a')
const TENANT_B = TenantId('tenant-b')
const WORKSPACE_A = WorkspaceId('workspace-a')
const WORKSPACE_B = WorkspaceId('workspace-b')

/** Build a minimal, real {@link SessionHeader}. */
function fixtureHeader(id: SessionId, createdAt: number): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id, createdAt, isSeeded: false }
}

/** Build a fixture {@link SessionLifecycleRecord} without exercising any (stubbed) real transition function. */
function fixtureRecord(overrides: {
  id?: SessionId
  createdAt?: number
  tenantId?: TenantId
  workspaceId?: WorkspaceId
  disposition?: SessionDisposition
  legalHold?: LegalHold
} = {}): SessionLifecycleRecord {
  const id = overrides.id ?? SessionId('session-fixture')
  return {
    header: fixtureHeader(id, overrides.createdAt ?? FIXED_TIME),
    tenantId: overrides.tenantId ?? TENANT_A,
    disposition: overrides.disposition ?? { kind: 'active' },
    ...overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId },
    ...overrides.legalHold === undefined ? {} : { legalHold: overrides.legalHold },
  }
}

/** Build a fixture {@link SessionDependents} inventory spanning all three non-query-index kinds. */
function fixtureDependents(sessionId: SessionId): SessionDependents {
  return {
    sessionId,
    attachmentIds: [AttachmentId('attachment-1'), AttachmentId('attachment-2')],
    memoryRefs: [MemoryRef('memory-1')],
    artifactRefs: [ArtifactRef('artifact-1'), ArtifactRef('artifact-2'), ArtifactRef('artifact-3')],
  }
}

/** Build a minimal, real `turn/start` {@link SessionEvent} at `seq`. */
function fixtureEvent(seq: SessionSeq): SessionEvent {
  return { type: 'turn/start', seq, time: FIXED_TIME, data: { turn: 0 } }
}

describe('P6-07 Contract — must[0]: listing supports tenant/workspace/status/time filters', () => {
  it('filters by tenant, admitting only matching-tenant sessions and excluding others', () => {
    const records = [
      fixtureRecord({ id: SessionId('s-tenant-a'), tenantId: TENANT_A }),
      fixtureRecord({ id: SessionId('s-tenant-b'), tenantId: TENANT_B }),
    ]
    const page = listSessions(records, { filters: [{ kind: 'tenant', values: [TENANT_A] }] })
    expect(page.items.map(record => record.header.id)).toStrictEqual([SessionId('s-tenant-a')])
  })

  it('filters by workspace, admitting only matching-workspace sessions and excluding sessions with no workspace or a different one', () => {
    const records = [
      fixtureRecord({ id: SessionId('s-workspace-a'), workspaceId: WORKSPACE_A }),
      fixtureRecord({ id: SessionId('s-workspace-b'), workspaceId: WORKSPACE_B }),
      fixtureRecord({ id: SessionId('s-no-workspace') }),
    ]
    const page = listSessions(records, { filters: [{ kind: 'workspace', values: [WORKSPACE_A] }] })
    expect(page.items.map(record => record.header.id)).toStrictEqual([SessionId('s-workspace-a')])
  })

  it('filters by status (disposition kind), admitting only sessions in the requested dispositions', () => {
    const records = [
      fixtureRecord({ id: SessionId('s-active'), disposition: { kind: 'active' } }),
      fixtureRecord({ id: SessionId('s-archived'), disposition: { kind: 'archived', archivedAt: FIXED_TIME, archivedBy: ACTOR } }),
      fixtureRecord({ id: SessionId('s-soft-deleted'), disposition: { kind: 'soft-deleted', deletedAt: FIXED_TIME, deletedBy: ACTOR } }),
    ]
    const page = listSessions(records, { filters: [{ kind: 'status', values: ['archived'] }] })
    expect(page.items.map(record => record.header.id)).toStrictEqual([SessionId('s-archived')])
  })

  it('filters by a time range, admitting sessions whose createdAt falls within [from, to] inclusive -- including both boundary values themselves -- and excluding ones outside it', () => {
    const from = FIXED_TIME - 500
    const to = FIXED_TIME + 500
    const records = [
      fixtureRecord({ id: SessionId('s-before'), createdAt: from - 1 }),
      fixtureRecord({ id: SessionId('s-at-from'), createdAt: from }),
      fixtureRecord({ id: SessionId('s-in-range'), createdAt: FIXED_TIME }),
      fixtureRecord({ id: SessionId('s-at-to'), createdAt: to }),
      fixtureRecord({ id: SessionId('s-after'), createdAt: to + 1 }),
    ]
    const page = listSessions(records, { filters: [{ kind: 'time', from, to }] })
    expect(page.items.map(record => record.header.id)).toStrictEqual([
      SessionId('s-at-from'), SessionId('s-in-range'), SessionId('s-at-to'),
    ])
  })

  it('combines multiple filter clauses with AND semantics, admitting only records matching every clause', () => {
    const records = [
      fixtureRecord({ id: SessionId('s-match'), tenantId: TENANT_A, disposition: { kind: 'active' } }),
      fixtureRecord({ id: SessionId('s-wrong-tenant'), tenantId: TENANT_B, disposition: { kind: 'active' } }),
      fixtureRecord({ id: SessionId('s-wrong-status'), tenantId: TENANT_A, disposition: { kind: 'archived', archivedAt: FIXED_TIME, archivedBy: ACTOR } }),
    ]
    const page = listSessions(records, {
      filters: [
        { kind: 'tenant', values: [TENANT_A] },
        { kind: 'status', values: ['active'] },
      ],
    })
    expect(page.items.map(record => record.header.id)).toStrictEqual([SessionId('s-match')])
  })
})

describe('P6-07 Contract — acceptance[0]: pagination over a large session fixture is stable with no omissions or duplicates', () => {
  const LARGE_FIXTURE_SIZE = 5_000
  const largeFixture: readonly SessionLifecycleRecord[] = Array.from({ length: LARGE_FIXTURE_SIZE }, (_, index) =>
    fixtureRecord({ id: SessionId(`session-${String(index).padStart(6, '0')}`), createdAt: FIXED_TIME + index }))
  const allIds = largeFixture.map(record => record.header.id)

  // Deterministic sample of varied page sizes (edge sizes 1 and the full
  // fixture length included) to exercise the pagination guarantee across
  // shapes, without fast-check's own assert/property wrapping -- that
  // wrapping summarizes a thrown failure into "Property failed after N
  // tests" and drops the real cause message from the top-level report,
  // which would obscure today's genuine `not implemented` failure.
  const midSample = fc.sample(fc.integer({ min: 2, max: LARGE_FIXTURE_SIZE - 1 }), { numRuns: 6, seed: 42 })
  const pageSizeSample = [1, ...midSample, LARGE_FIXTURE_SIZE]

  it.each(pageSizeSample)('walking every page via nextCursor from an absent cursor to exhaustion returns every session exactly once, for page size %i', (limit) => {
    const seen = new Set<string>()
    let cursor: SessionLifecycleCursor | undefined
    let guard = 0
    do {
      const page = listSessions(largeFixture, { limit, ...cursor === undefined ? {} : { cursor } })
      for (const item of page.items) {
        const id = String(item.header.id)
        if (seen.has(id)) throw new Error(`duplicate session ${id} returned across pages`)
        seen.add(id)
      }
      cursor = page.nextCursor
      guard += 1
    } while (cursor !== undefined && guard <= LARGE_FIXTURE_SIZE + 1)
    expect(guard).toBeLessThanOrEqual(LARGE_FIXTURE_SIZE + 1)
    expect(seen.size).toBe(allIds.length)
    expect([...seen].sort()).toStrictEqual([...allIds].map(String).sort())
  })

  it('paginates correctly when multiple sessions share the exact same createdAt, exercising the id tiebreak rather than relying on createdAt alone to order records', () => {
    const collidingFixture: readonly SessionLifecycleRecord[] = Array.from({ length: 50 }, (_, index) =>
      fixtureRecord({ id: SessionId(`collide-${String(index).padStart(3, '0')}`), createdAt: FIXED_TIME }))
    const collidingIds = collidingFixture.map(record => record.header.id)

    const seen = new Set<string>()
    let cursor: SessionLifecycleCursor | undefined
    let guard = 0
    do {
      const page = listSessions(collidingFixture, { limit: 7, ...cursor === undefined ? {} : { cursor } })
      for (const item of page.items) {
        const id = String(item.header.id)
        if (seen.has(id)) throw new Error(`duplicate session ${id} returned across pages`)
        seen.add(id)
      }
      cursor = page.nextCursor
      guard += 1
    } while (cursor !== undefined && guard <= collidingFixture.length + 1)
    expect(seen.size).toBe(collidingIds.length)
    expect([...seen].sort()).toStrictEqual([...collidingIds].map(String).sort())

    // Iteration order is deterministic across repeated calls with an identical
    // fixture: the id tiebreak, not incidental array/object ordering, decides it.
    const firstPageAgain = listSessions(collidingFixture, { limit: 7 })
    const firstPageOriginal = listSessions(collidingFixture, { limit: 7 })
    expect(firstPageAgain.items.map(record => record.header.id)).toStrictEqual(
      firstPageOriginal.items.map(record => record.header.id),
    )
  })
})

describe('P6-07 Contract — must[1]: soft delete, legal hold, hard erase, and archive are kept genuinely distinct', () => {
  const dispositionProducers: readonly {
    readonly label: string
    readonly produce: (record: SessionLifecycleRecord) => SessionLifecycleRecord
    readonly expectedDisposition: SessionDisposition
  }[] = [
    {
      label: 'archiveSession',
      produce: record => archiveSession(record, ACTOR, FIXED_TIME),
      expectedDisposition: { kind: 'archived', archivedAt: FIXED_TIME, archivedBy: ACTOR },
    },
    {
      label: 'softDeleteSession',
      produce: record => softDeleteSession(record, ACTOR, FIXED_TIME),
      expectedDisposition: { kind: 'soft-deleted', deletedAt: FIXED_TIME, deletedBy: ACTOR },
    },
  ]

  it.each(dispositionProducers)('$label produces exactly the expected disposition object -- including the real attribution fields passed in, not just its kind -- never conflated with the other', ({ produce, expectedDisposition }) => {
    const before = fixtureRecord()
    const after = produce(before)
    expect(after.disposition).toStrictEqual(expectedDisposition)
  })

  it('placeLegalHold adds an independent hold marker without changing the session\'s disposition, proving legal hold is not itself a disposition value', () => {
    const before = fixtureRecord({ disposition: { kind: 'active' } })
    const after = placeLegalHold(before, ACTOR, 'litigation pending', FIXED_TIME)
    expect(after.disposition).toStrictEqual(before.disposition)
    expect(after.legalHold).toStrictEqual({ heldAt: FIXED_TIME, heldBy: ACTOR, reason: 'litigation pending' })
  })

  it('a session can be simultaneously soft-deleted and under legal hold, proving legal hold and deletion are independent concerns rather than conflated', () => {
    const softDeleted = fixtureRecord({ disposition: { kind: 'soft-deleted', deletedAt: FIXED_TIME, deletedBy: ACTOR } })
    const held = placeLegalHold(softDeleted, ACTOR, 'litigation pending', FIXED_TIME)
    expect(held.disposition).toStrictEqual(softDeleted.disposition)
    expect(held.legalHold).toStrictEqual({ heldAt: FIXED_TIME, heldBy: ACTOR, reason: 'litigation pending' })
  })

  it('hardErase is a one-way destructive operation, not a disposition value -- its result carries no disposition field at all', () => {
    const clear = fixtureRecord()
    const dependents = fixtureDependents(clear.header.id)
    const proof = assertNoLegalHold(clear)
    const result = hardErase(clear, dependents, proof, FIXED_TIME)
    expect(result).not.toHaveProperty('disposition')
    expect(result.sessionId).toBe(clear.header.id)
  })
})

describe('P6-07 Contract — acceptance[1]: legal hold blocks hard erase', () => {
  it('assertNoLegalHold refuses a session under legal hold with LegalHoldBlocksErasureError', () => {
    const held = fixtureRecord({ legalHold: { heldAt: FIXED_TIME, heldBy: ACTOR, reason: 'litigation pending' } })
    expect(() => assertNoLegalHold(held)).toThrow(LegalHoldBlocksErasureError)
  })

  it('assertNoLegalHold refuses a session that is under legal hold AND already soft-deleted, proving disposition never bypasses the hold check', () => {
    const heldAndSoftDeleted = fixtureRecord({
      disposition: { kind: 'soft-deleted', deletedAt: FIXED_TIME, deletedBy: ACTOR },
      legalHold: { heldAt: FIXED_TIME, heldBy: ACTOR, reason: 'litigation pending' },
    })
    expect(() => assertNoLegalHold(heldAndSoftDeleted)).toThrow(LegalHoldBlocksErasureError)
  })

  it('a session with no legal hold is admitted: assertNoLegalHold\'s proof authorizes a real hardErase call all the way through', () => {
    const clear = fixtureRecord()
    const dependents = fixtureDependents(clear.header.id)
    const proof = assertNoLegalHold(clear)
    const result = hardErase(clear, dependents, proof, FIXED_TIME)
    expect(result.sessionId).toBe(clear.header.id)
  })
})

describe('P6-07 Contract — must[2]: deletion propagates to query-index/attachments/memory/artifacts per policy', () => {
  it('SOFT_DELETE_POLICY only hides the query index, leaving attachments/memory/artifacts untouched', () => {
    const dependents = fixtureDependents(SessionId('s-soft-delete-propagation'))
    const outcome = propagateDeletion(dependents, SOFT_DELETE_POLICY)
    expect(outcome.targets).toStrictEqual([
      { kind: 'query-index', action: 'hide', sessionId: dependents.sessionId },
    ])
  })

  it('HARD_ERASE_POLICY destroys all four target kinds completely, matching acceptance[2]', () => {
    const dependents = fixtureDependents(SessionId('s-hard-erase-propagation'))
    const outcome = propagateDeletion(dependents, HARD_ERASE_POLICY)
    expect(outcome.targets).toStrictEqual([
      { kind: 'query-index', action: 'destroy', sessionId: dependents.sessionId },
      { kind: 'attachments', action: 'destroy', attachmentIds: dependents.attachmentIds },
      { kind: 'memory', action: 'destroy', memoryRefs: dependents.memoryRefs },
      { kind: 'artifacts', action: 'destroy', artifactRefs: dependents.artifactRefs },
    ])
  })
})

describe('P6-07 Contract — acceptance[2]: an authorized erase propagates completely to every dependent store', () => {
  it('an authorized hardErase (no legal hold) reaches all four dependent-store kinds, in order, with the full real target shape per kind -- not just kind order -- matching must[2]\'s standalone propagateDeletion(HARD_ERASE_POLICY) rigor', () => {
    const clear = fixtureRecord()
    const dependents = fixtureDependents(clear.header.id)
    const proof = assertNoLegalHold(clear)
    const result = hardErase(clear, dependents, proof, FIXED_TIME)
    expect(result.erasedAt).toBe(FIXED_TIME)
    expect(result.propagation.targets).toStrictEqual([
      { kind: 'query-index', action: 'destroy', sessionId: dependents.sessionId },
      { kind: 'attachments', action: 'destroy', attachmentIds: dependents.attachmentIds },
      { kind: 'memory', action: 'destroy', memoryRefs: dependents.memoryRefs },
      { kind: 'artifacts', action: 'destroy', artifactRefs: dependents.artifactRefs },
    ])
  })
})

describe('P6-07 Contract — acceptance[3]: reading a corrupted log returns the minimal recoverable range plus evidence, never a fabricated full recovery', () => {
  it('a corruption partway through the log recovers only the valid prefix before it, plus evidence -- never a line after it, even one that is individually well-formed', () => {
    const sessionId = SessionId('s-partial-corruption')
    const eventA = fixtureEvent(SessionSeq(0))
    const eventB = fixtureEvent(SessionSeq(1))
    const lines: readonly RawSessionLogLine[] = [
      { ok: true, event: eventA },
      { ok: true, event: eventB },
      { ok: false, lineNumber: 2, raw: '{"type":"turn/end","seq":2,"time":', parseError: 'Unexpected end of JSON input' },
      { ok: true, event: fixtureEvent(SessionSeq(3)) },
    ]
    const result = readSessionLogWithRepair(sessionId, lines)
    expect(result).toStrictEqual({
      recoverable: 'partial',
      events: [eventA, eventB],
      recoveredThroughSeq: eventB.seq,
      evidence: { lineNumber: 2, raw: '{"type":"turn/end","seq":2,"time":', parseError: 'Unexpected end of JSON input' },
    })
  })

  it('a fully valid log with no corruption reads back completely, with no partial-recovery evidence', () => {
    const sessionId = SessionId('s-no-corruption')
    const eventA = fixtureEvent(SessionSeq(0))
    const eventB = fixtureEvent(SessionSeq(1))
    const lines: readonly RawSessionLogLine[] = [
      { ok: true, event: eventA },
      { ok: true, event: eventB },
    ]
    const result = readSessionLogWithRepair(sessionId, lines)
    expect(result).toStrictEqual({ recoverable: 'full', events: [eventA, eventB] })
  })

  it('a corruption at the very first line leaves no recoverable prefix at all, returning evidence with no events', () => {
    const sessionId = SessionId('s-corrupted-at-start')
    const lines: readonly RawSessionLogLine[] = [
      { ok: false, lineNumber: 0, raw: 'not even json', parseError: 'Unexpected token o in JSON at position 1' },
      { ok: true, event: fixtureEvent(SessionSeq(1)) },
    ]
    const result = readSessionLogWithRepair(sessionId, lines)
    expect(result).toStrictEqual({
      recoverable: 'none',
      evidence: { lineNumber: 0, raw: 'not even json', parseError: 'Unexpected token o in JSON at position 1' },
    })
  })
})
