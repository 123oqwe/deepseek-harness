/**
 * Durable projection state for dynamic runtime context.
 * @module @deepseek-ai/dsh-agent-loop/runtime-context
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextSnapshotSection } from '@deepseek-ai/dsh-llm'
import { assertRuntimeTenantPolicy, currentPrincipal, currentTenantId, sameChainShape } from '@deepseek-ai/dsh-principal'
import type { IdentityContext, Principal } from '@deepseek-ai/dsh-principal/types'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { isReplacementSurfaceEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'

const SOURCE = '@deepseek-ai/dsh-system-prompt'
const CLEARED = 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.'

function isOwned(message: UserMessage): boolean {
  return message.source.kind === 'plugin' && message.source.plugin === SOURCE
}

function textOf(message: UserMessage): string | undefined {
  const [block] = message.content
  return message.content.length === 1 && block?.type === 'text' ? block.text : undefined
}

/** Tracks the last retained runtime-context snapshot without owning its commit. */
export class RuntimeContextProjection {
  /** `undefined` means no snapshot ever existed; `null` means none is retained. */
  private retained: { seq: SessionSeq; text: string | undefined } | null | undefined

  /**
   * Restore projection state once, then follow authoritative session events.
   * @param ctx - agent-scoped event context.
   * @param session - session receiving projected messages.
   */
  constructor(ctx: Context, session: Session) {
    const surface = new Set(session.surface.nodes)
    for (let index = session.seq - 1; index >= 0; index -= 1) {
      const event = session.eventAt(SessionSeq(index))
      if (event?.type !== 'user/message' || !isOwned(event.data)) continue
      this.retained ??= null
      if (surface.has(event.seq)) {
        this.retained = { seq: event.seq, text: textOf(event.data) }
        break
      }
    }

    ctx.on('session/event', (subject, event) => {
      if (subject !== session) return
      if (event.type === 'user/message' && isOwned(event.data)) {
        this.retained = { seq: event.seq, text: textOf(event.data) }
      } else if (this.retained
        && isReplacementSurfaceEvent(event)
        && event.sourceEventSeqs?.includes(this.retained.seq) === true) {
        this.retained = null
      }
    })
  }

  /**
   * Create an uncommitted snapshot only when the retained value differs.
   * @param current - fully rendered dynamic context.
   * @param sections - named contributions that formed the current snapshot.
   * @returns a candidate user message, or `undefined` when no update is needed.
   */
  project(current: string, sections: readonly ContextSnapshotSection[]): UserMessage | undefined {
    if (this.retained === undefined && current.length === 0) return
    const snapshot = current.length === 0 ? CLEARED : current
    if (this.retained?.text === snapshot) return
    return createUserMessage({
      content: [{ type: 'text', text: snapshot }],
      // The cleared marker has no contributions left to attribute.
      source: sections.length === 0
        ? { kind: 'plugin', plugin: SOURCE }
        : { kind: 'plugin', plugin: SOURCE, form: 'snapshot', sections },
    })
  }
}

/**
 * The {@link IdentityContext} a prior run already durably anchored to this
 * session, if any (first100 registry P2-01 acceptance[0]). Scans for the
 * LAST `identity/attached` event (`@deepseek-ai/dsh-session/types`) in
 * replayed history — that log-only event's own doc records why the last
 * occurrence is authoritative. Never derives identity from `user/message`
 * or any other model-visible content (must[2]).
 * @param session - the session to scan.
 * @returns the session's currently-recorded identity, or `undefined` when none was ever attached.
 */
export function lastAttachedIdentity(session: Session): IdentityContext | undefined {
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'identity/attached') return event.data.identity
  }
  return undefined
}

/**
 * Whether two principals are the same identity: same `kind`, `id`, and
 * `tenantId`. Structural equality, not object identity — a principal
 * re-hydrated from a durable `identity/attached` event and one freshly
 * constructed for a new run are never the same object even when they name
 * the same real-world actor, so `===` is the wrong check here (unlike
 * `./chain.ts`'s `adminGrantOwners`, which deliberately does want object
 * identity for its own, different reason).
 * @param a - first principal.
 * @param b - second principal.
 * @returns `true` when `a` and `b` share `kind`, `id`, and `tenantId`.
 */
function samePrincipalIdentity(a: Principal, b: Principal): boolean {
  return a.kind === b.kind && a.id === b.id && a.tenantId === b.tenantId
}

/**
 * Resolve which {@link IdentityContext} a live agent should attach for this
 * run, and whether that resolution must be durably logged (first100 registry
 * P2-01 acceptance[0]/[1]).
 *
 * When this run supplies no identity (`supplied` is `undefined`), the
 * session's already-recorded identity carries forward unchanged and nothing
 * new is logged. When this run supplies an identity AND the session already
 * has one recorded, this is the runtime-policy layer's real call site
 * (`assertRuntimeTenantPolicy`, `@deepseek-ai/dsh-principal`) — distinct from
 * `extendChain`'s construction-time check (`./chain.ts` in
 * `dsh-principal`): it rejects a resumed session whose caller now claims a
 * different tenant than the one this exact session was already established
 * for (registry P2-01 gate: "request tenant equals authenticated tenant").
 * A same-tenant resupply is not itself rejected — `dsh-principal` has no
 * precedent anywhere for treating a same-tenant, different-principal resupply
 * as an anomaly (`assertRuntimeTenantPolicy` only ever compares tenant ids,
 * never principal identity), and a resumed session legitimately continuing
 * under a different same-tenant principal — an operator taking over from an
 * automated service account, for instance — is an ordinary case this module
 * must still make traceable, not a forgery to reject. So it is logged
 * instead: `shouldLog` is `true` whenever the principal this run actually
 * attaches (`kind`/`id`/`tenantId`, via {@link samePrincipalIdentity}) differs
 * from what is currently recorded, not only on the session's first-ever
 * attachment — otherwise a later reader of the session log would see only
 * the original principal and never learn a different one actually acted,
 * undermining acceptance[0]'s "any action traceable to root user/tenant and
 * full delegation chain".
 *
 * A terminal-principal match is not enough on its own: two chains can agree
 * on `currentPrincipal` while disagreeing on everything that produced
 * it — a different root, a different delegation depth, a same-tenant
 * principal delegated to `supplied`'s terminal principal through a hop
 * `recorded` never had. That is a genuinely different delegation chain, and
 * acceptance[0] asks for traceability to the *full* chain, not only the
 * principal currently acting. So `shouldLog` also becomes `true` whenever
 * `recorded.chain` and `supplied.chain` have a different shape
 * ({@link sameChainShape}, `@deepseek-ai/dsh-principal`) even when their
 * terminal principals are identical — this closes the gap a fix round 2
 * Reviewer found in the terminal-only comparison: same acting principal,
 * silently different provenance underneath it, never logged.
 * @param recorded - the identity a prior run already attached to this session, from {@link lastAttachedIdentity}.
 * @param supplied - this run's own `AgentOptions.identity`, if any.
 * @throws {@link TenantMismatchError} (`@deepseek-ai/dsh-principal/types`) when `supplied` claims a tenant that differs from `recorded`'s.
 * @returns the identity to attach as `Agent.identity`, and whether the caller must durably log it via a new `identity/attached` event.
 */
export function resolveSessionIdentity(
  recorded: IdentityContext | undefined,
  supplied: IdentityContext | undefined,
): { identity: IdentityContext | undefined; shouldLog: boolean } {
  if (supplied === undefined) return { identity: recorded, shouldLog: false }
  if (recorded !== undefined) {
    assertRuntimeTenantPolicy(recorded, currentTenantId(supplied.chain))
  }
  const shouldLog = recorded === undefined
    || !samePrincipalIdentity(currentPrincipal(recorded.chain), currentPrincipal(supplied.chain))
    || !sameChainShape(recorded.chain, supplied.chain)
  return { identity: supplied, shouldLog }
}
