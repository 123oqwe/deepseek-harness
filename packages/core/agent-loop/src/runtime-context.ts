/**
 * Durable projection state for dynamic runtime context.
 * @module @deepseek-ai/dsh-agent-loop/runtime-context
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextSnapshotSection } from '@deepseek-ai/dsh-llm'
import { assertRuntimeTenantPolicy, currentTenantId } from '@deepseek-ai/dsh-principal'
import type { IdentityContext } from '@deepseek-ai/dsh-principal/types'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'
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
  private retained: { seq: number; text: string | undefined } | null | undefined

  /**
   * Restore projection state once, then follow authoritative session events.
   * @param ctx - agent-scoped event context.
   * @param session - session receiving projected messages.
   */
  constructor(ctx: Context, session: Session) {
    const surface = new Set(session.surface.nodes)
    for (let index = session.events.length - 1; index >= 0; index -= 1) {
      const event = session.events[index]
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
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'identity/attached') return event.data.identity
  }
  return undefined
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
 * A first-ever attachment (no prior recording) has nothing to validate
 * against and is accepted, then logged once.
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
  return { identity: supplied, shouldLog: recorded === undefined }
}
