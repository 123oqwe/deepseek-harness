/**
 * Epic P6-07 Usage stage, forced adjacent guard: this index stores no tenant
 * or workspace column, so a `'tenant'`/`'workspace'` clause reaching the ranked
 * full-text path is refused rather than silently dropped.
 *
 * This is not one of the stage's frozen RED cases. Widening
 * `SessionResultFilter` with the two new clauses turned this provider's
 * exhaustive `switch` into a compile error, and the only safe resolution is an
 * explicit refusal: a dropped tenant clause would return another tenant's
 * sessions to a caller that asked to be scoped to its own.
 *
 * The assertion is on the thrown error's code, evaluated identically on every
 * platform — nothing here depends on a filesystem or on SQLite's on-disk form.
 */

import { describe, expect, it } from 'vitest'
import { TenantId } from '@deepseek-ai/dsh-principal/types'
import type { SessionQueryErrorCode } from '@deepseek-ai/dsh-session-query'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { buildSessionWhere } from '../src/query.ts'

function expectCode(code: SessionQueryErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

describe('sqlite session search filter support (P6-07 must[0])', () => {
  it('refuses a tenant clause rather than compiling a search that ignores it', () => {
    expect(() => buildSessionWhere([{ kind: 'tenant', values: [TenantId('acme')] }]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })

  it('refuses a workspace clause rather than compiling a search that ignores it', () => {
    expect(() => buildSessionWhere([{ kind: 'workspace', values: [WorkspaceId('workspace-a')] }]))
      .toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
  })
})
