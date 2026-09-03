/**
 * Package-owned session-event invariant for Memory: every logged
 * `memory/access` read (`query`/`get`/`export`) carries a complete
 * {@link MemoryAccessContext} — first100 registry P6-01 `must[3]`. No other
 * package can observe this relation: `memory/access` is this package's own
 * event, minted only by `MemoryRuntime` (`./index.ts`), so the check is
 * necessarily package-owned rather than a repo-wide invariant.
 * @module @deepseek-ai/dsh-memory/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory'

/** Cordis companion plugin name. */
export const name = 'memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/**
 * Validate a `memory/access` read's access context; ignore unrelated events
 * and write operations. `SessionEventMap` guarantees these fields are
 * present at the type level, but a durable log entry is a file boundary a
 * downlevel or buggy build may have written without them actually holding a
 * real value — so this checks degeneracy (empty id/string, an all-empty
 * budget), not mere presence, which stays genuinely informative rather than
 * redundant with the static type.
 */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'memory/access') return
  const { data } = event
  if (data.operation !== 'query' && data.operation !== 'get' && data.operation !== 'export') return
  const { accessContext } = data
  if (accessContext.principal.id.length === 0) {
    fail(`memory/access ${data.operation} carries an empty accessContext.principal.id`)
  }
  if (accessContext.purpose.length === 0) {
    fail(`memory/access ${data.operation} carries an empty accessContext.purpose`)
  }
  if (accessContext.scope.tenantId.length === 0) {
    fail(`memory/access ${data.operation} carries an empty accessContext.scope.tenantId`)
  }
  if (accessContext.contextBudget.maxRecords === undefined && accessContext.contextBudget.maxTokens === undefined) {
    fail(`memory/access ${data.operation} carries an accessContext.contextBudget with no maxRecords or maxTokens bound`)
  }
}

/** Install validation for loaded and newly appended memory access events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.snapshotEvents()) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
