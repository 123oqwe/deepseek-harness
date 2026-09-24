/**
 * P6-07 acceptance[1] at the function layer: a legal hold blocks hard erase
 * even when the caller hands `hardErase` a no-legal-hold proof that
 * `assertNoLegalHold` issued for a different, unheld record.
 *
 * The proof is the only argument that can authorize an erase, so a proof
 * that authorizes any record authorizes every record. The control erases the
 * unheld record with its own proof, and shows the held record cannot obtain a
 * proof of its own.
 * @module packages/session/session-lifecycle/tests/erase-proof
 */

import { describe, expect, it } from 'vitest'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/types'
import { LegalHoldBlocksErasureError, assertNoLegalHold, hardErase, placeLegalHold } from '../src/index.ts'
import type { SessionDependents, SessionLifecycleRecord } from '../src/index.ts'

/**
 * An active, unheld lifecycle record.
 * @param id - the session id.
 * @returns the record.
 */
function activeRecord(id: string): SessionLifecycleRecord {
  return {
    header: { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, isSeeded: false },
    tenantId: TenantId('acme'),
    disposition: { kind: 'active' },
  }
}

/**
 * A record's dependents with nothing to propagate to.
 * @param record - the record.
 * @returns its empty dependent inventory.
 */
function dependentsOf(record: SessionLifecycleRecord): SessionDependents {
  return { sessionId: record.header.id, attachmentIds: [], memoryRefs: [], artifactRefs: [] }
}

describe('P6-07 acceptance[1] at the function layer: an erase proof is bound to the record it was issued for', () => {
  it('hardErase refuses a held record even when handed a proof issued for a different, unheld record', () => {
    const unheld = activeRecord('p6-07-t5-unheld')
    const held = placeLegalHold(activeRecord('p6-07-t5-held'), PrincipalId('p6-07-t5-admin'), 'litigation', 2)
    const proofForUnheld = assertNoLegalHold(unheld)

    // Control: the unheld record's own proof erases it, and the held record
    // cannot obtain a proof of its own.
    expect(hardErase(unheld, dependentsOf(unheld), proofForUnheld, 3).sessionId).toBe(unheld.header.id)
    expect(() => assertNoLegalHold(held)).toThrow(LegalHoldBlocksErasureError)

    expect(() => hardErase(held, dependentsOf(held), proofForUnheld, 4)).toThrow(LegalHoldBlocksErasureError)
  })
})
