/**
 * The values every execution path must supply to build a manifest, in one
 * implementation (Epic P2-03 must[0], BLOCKED-143).
 *
 * Both paths — the native tool call and the code-mode sub-dispatch — need a
 * run, an actor and an idempotency key. Each deriving its own would be one
 * rule with two implementations, which is what BLOCKED-136 records the cost of.
 *
 * @module @deepseek-ai/dsh-action-manifest/identity
 */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createAnonymousDevPrincipal, currentPrincipal } from '@deepseek-ai/dsh-principal'
import type { IdentityContext, Principal, PrincipalId, RunId, TenantId } from '@deepseek-ai/dsh-principal/types'
import type { ActionId, ArgumentsHash, IdempotencyKey, IdempotencyScope } from './types.ts'

/** The run and actor one session's manifests are attributed to. */
export interface ManifestAttribution {
  /** The execution run the action happens inside. */
  readonly runId: RunId
  /** The principal the action is attributed to. */
  readonly actor: Principal
}

/**
 * Who a session's actions are attributed to, and which run they belong to.
 *
 * Both come from the run's durably attached identity, never from
 * model-visible content, and they are derived TOGETHER because they answer
 * from the same branch: an attached identity supplies both its run and its
 * principal chain, and its absence has to be answered once rather than twice.
 * Splitting them is how the run id came to be the session id — the earlier
 * arrangement asked for an actor from the identity and for a run from the
 * caller, and the caller had only a session to hand.
 *
 * When nothing was attached the answer is the anonymous-dev principal the
 * harness already uses for unauthenticated local work, keyed to the session,
 * and a run id keyed to the same session under its own prefix. The two
 * fallbacks are deliberately DIFFERENT strings: a run and a principal are
 * different things, and while they shared a spelling the durable log rendered
 * both as one value, so a reader could not tell the actor from the run it
 * acted in.
 * @param identity - the run's attached identity, absent when none was.
 * @param sessionId - the session, used to key the anonymous fallback.
 * @returns the run and actor for this session's manifests.
 */
export function manifestAttribution(identity: IdentityContext | undefined, sessionId: IdempotencyScope): ManifestAttribution {
  if (identity === undefined) {
    return {
      runId: brandString<RunId>(`anonymous-run:${sessionId}`),
      actor: createAnonymousDevPrincipal(brandString<PrincipalId>(`anonymous:${sessionId}`), brandString<TenantId>('local')),
    }
  }
  return { runId: identity.runId, actor: currentPrincipal(identity.chain) }
}

/**
 * The idempotency key for one action attempt.
 *
 * Derived, never random, and the derivation IS the contract: a crash and retry
 * of the same attempt must present the same key, while a genuinely new attempt
 * must not.
 *
 * **Keyed on the SESSION, not the run.** What a retry needs is an identity
 * that survives a restart, and the two candidates differ exactly there: a
 * session id is replayed when the session is, while `RunId` is minted per
 * invocation (`run-<uuid>`), so a key derived from it would be new after every
 * restart — a replayed action would present an unrecognized key and the
 * external effect would happen twice, which is the case P4-12's ledger
 * exists to refuse (acceptance[0]).
 *
 * The other two inputs give the opposite direction: a new action carries a new
 * `actionId`, and including the arguments hash makes the same id with
 * different arguments a DIFFERENT key rather than a silent reuse (P4-12
 * acceptance[2]).
 * @param sessionId - the session the action belongs to, stable across restarts.
 * @param actionId - the action's own id.
 * @param argumentsHash - the canonical hash of its arguments.
 * @returns a stable key for this attempt.
 */
export function manifestIdempotencyKey(sessionId: IdempotencyScope, actionId: ActionId, argumentsHash: ArgumentsHash): IdempotencyKey {
  return brandString<IdempotencyKey>(
    createHash('sha256').update(`${sessionId} ${actionId} ${argumentsHash}`).digest('hex'),
  )
}
