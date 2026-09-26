/**
 * The in-process grant store and worker view for Epic P2-08's first slice.
 *
 * {@link createMemoryGrantStore} issues grants from valid drafts, lists them
 * (revoked ones included), revokes them while advancing an epoch, and counts a
 * use on the grant that allows an action (must[2]). {@link openGrantView} is
 * the read side a worker holds: it re-reads the source's grants when the epoch
 * changes, so a revocation reaches it at its next authorization, and it fails
 * closed — a source it cannot read allows nothing (acceptance[2]).
 *
 * Both decide through {@link matchGrants}; neither reinterprets a grant. A
 * grant is immutable once stored: a use or a revocation replaces its record
 * rather than mutating it, so a list taken earlier is a stable snapshot.
 *
 * @module @deepseek-ai/dsh-grant-store/store
 */

import { GrantError, matchGrants, validateGrantDraft } from './match.ts'
import type { Grant, GrantDecision, GrantDraft, GrantSource, GrantStore, GrantView, GrantedAction } from './types.ts'

/**
 * Create an in-process grant store.
 * @returns a store backed by an array of grants, an id counter and an epoch.
 */
export function createMemoryGrantStore(): GrantStore {
  const grants: Grant[] = []
  let nextId = 1
  let epoch = 0
  return {
    issue(draft: GrantDraft, atMs: number): Grant {
      const validation = validateGrantDraft(draft)
      if (!validation.ok) throw new GrantError(validation.code)
      const grant: Grant = { ...draft, id: `grant-${String(nextId)}`, issuedAtMs: atMs, uses: 0 }
      nextId += 1
      grants.push(grant)
      return grant
    },
    list(): readonly Grant[] {
      return [...grants]
    },
    revoke(id: string, atMs: number): void {
      const index = grants.findIndex(grant => grant.id === id)
      const grant = grants[index]
      if (grant === undefined) return
      grants[index] = { ...grant, revokedAtMs: atMs }
      epoch += 1
    },
    authorize(action: GrantedAction): GrantDecision {
      const decision = matchGrants(grants, action)
      if (decision.kind !== 'allow') return decision
      const index = grants.findIndex(grant => grant.id === decision.grantId)
      const grant = grants[index]
      if (grant !== undefined) grants[index] = { ...grant, uses: grant.uses + 1 }
      return decision
    },
    epoch(): number {
      return epoch
    },
  }
}

/**
 * Open a worker's view over a grant source. Each authorization rechecks the
 * source's epoch and re-reads its grants when the epoch has moved, so a
 * revocation on the source reaches the view at its next authorization. A
 * source whose epoch or grants cannot be read allows nothing.
 * @param source - the store's epoch and current grants, as a worker reaches them.
 * @returns the view.
 */
export function openGrantView(source: GrantSource): GrantView {
  let cachedEpoch: number | undefined
  let cachedGrants: readonly Grant[] = []
  return {
    authorize(action: GrantedAction): GrantDecision {
      try {
        const epoch = source.epoch()
        if (epoch !== cachedEpoch) {
          cachedGrants = source.list()
          cachedEpoch = epoch
        }
      } catch {
        // Fail closed: a worker that cannot confirm the source's current epoch or grants allows nothing (acceptance[2]).
        return { kind: 'no-grant' }
      }
      return matchGrants(cachedGrants, action)
    },
  }
}
