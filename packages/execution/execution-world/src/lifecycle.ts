/**
 * The ExecutionWorld lifecycle decisions: which state transitions are legal,
 * which provider may serve a request, and what a restore is allowed to widen.
 *
 * Pure and provider-free — every function here is a decision over values, so
 * the C stage can settle the rules before any world exists. The OCI
 * runtime-spec state ordering is adapted rather than invented
 * (`standards-ownership.json`: P3-01 owns that standard).
 * @module @deepseek-ai/dsh-execution-world/lifecycle
 */

import {
  WORLD_SPEC_DIMENSIONS,
  type WorldProvider,
  type WorldSpec,
  type WorldSpecDimension,
  type WorldState,
  type WorldStopReason,
} from './types.ts'

/**
 * The legal successors of each {@link WorldState}, adapted from the OCI
 * runtime-spec ordering.
 *
 * `stopped` is terminal and has no successors: a world that stopped is gone,
 * and `restore` mints a NEW world from a snapshot rather than reviving this one.
 * That is why the table has no edge back to `creating` — a revival edge would
 * make one `WorldId` name two different confinements over time, and every
 * audit record naming that id would become ambiguous.
 */
const WORLD_STATE_SUCCESSORS: Readonly<Record<WorldState, readonly WorldState[]>> = {
  creating: ['created', 'stopped'],
  created: ['running', 'stopped'],
  running: ['stopped'],
  stopped: [],
}

/**
 * Whether a world may move from `from` to `to`.
 * @param from - the current state.
 * @param to - the proposed next state.
 * @returns true only for an edge the table above declares.
 */
export function isLegalWorldTransition(from: WorldState, to: WorldState): boolean {
  return WORLD_STATE_SUCCESSORS[from].includes(to)
}

/**
 * The dimensions a spec leaves unanswered (must[1]).
 *
 * Reads {@link WORLD_SPEC_DIMENSIONS} rather than a second hand-written list,
 * so adding a dimension cannot leave this check behind.
 * @param spec - the candidate spec, possibly incomplete.
 * @returns the missing dimension names, empty when the spec answers all nine.
 */
export function missingWorldSpecDimensions(
  spec: Partial<WorldSpec>,
): readonly WorldSpecDimension[] {
  return WORLD_SPEC_DIMENSIONS.filter(dimension => spec[dimension] === undefined)
}

/** Why no world could be created for a request (acceptance[1]). */
export interface WorldSelectionRefusal {
  readonly outcome: 'refused'
  /** Closed reason; `no-provider` means none was registered at all. */
  readonly reason: 'no-provider' | 'unsatisfiable' | 'incomplete-spec'
  /**
   * Per-provider dimensions that could not be met, for the audit.
   *
   * Carried because "no provider could do it" and "every provider failed the
   * same dimension" call for different operator action, and a single boolean
   * cannot tell them apart.
   */
  readonly unsatisfiable: Readonly<Record<string, readonly WorldSpecDimension[]>>
}

/** The provider chosen to serve a request. */
export interface WorldSelectionChoice {
  readonly outcome: 'selected'
  readonly provider: WorldProvider
}

/** A closed selection answer: exactly one provider, or a refusal with its reason. */
export type WorldSelection = WorldSelectionChoice | WorldSelectionRefusal

/**
 * Choose the provider for `spec`, or refuse (acceptance[1]).
 *
 * **Fails closed, and never degrades.** When no provider satisfies every
 * dimension the answer is a refusal — not the closest provider, not the local
 * one, not a spec with the unmet dimension dropped. Silent degradation is the
 * specific failure acceptance[1] names, and it is prevented here by the return
 * type: there is no partial result to return, so a caller cannot mistake a
 * weakened world for the requested one.
 *
 * Candidate order is the caller's registration order and the FIRST satisfying
 * provider wins. Deliberate: "most confined wins" would need a total order over
 * nine dimensions that nothing in this harness defines, and inventing one here
 * would silently re-rank a deployment's own preference.
 * @param spec - the requested world; an incomplete spec is refused before any provider is consulted.
 * @param providers - candidate providers in the deployment's own preference order.
 * @returns the chosen provider, or a refusal carrying every provider's unmet dimensions.
 */
export function selectWorldProvider(
  spec: Partial<WorldSpec>,
  providers: readonly WorldProvider[],
): WorldSelection {
  const missing = missingWorldSpecDimensions(spec)
  if (missing.length > 0) {
    // Refused before any provider sees it: asking a provider to judge a spec
    // that does not say what it wants invites the provider to fill the gap.
    return { outcome: 'refused', reason: 'incomplete-spec', unsatisfiable: { request: missing } }
  }
  if (providers.length === 0) {
    return { outcome: 'refused', reason: 'no-provider', unsatisfiable: {} }
  }
  const complete = spec as WorldSpec
  const unsatisfiable: Record<string, readonly WorldSpecDimension[]> = {}
  for (const provider of providers) {
    const unmet = provider.unsatisfiableDimensions(complete)
    if (unmet.length === 0) return { outcome: 'selected', provider }
    unsatisfiable[provider.id] = unmet
  }
  return { outcome: 'refused', reason: 'unsatisfiable', unsatisfiable }
}

/**
 * Whether a snapshot may be restored under `into`.
 *
 * A restore may narrow and never widen, the same monotonicity the policy group
 * holds to: a snapshot taken under weaker confinement carries files, processes
 * and secrets the requested world did not ask to admit, so restoring it would
 * grant what the new spec refused. Compared by digest rather than by structure
 * because the digest is what a policy decision recorded.
 * @param snapshotSpec - digest of the spec the snapshot was taken under.
 * @param intoSpec - digest of the spec it would be restored into.
 * @returns true only when the two name the same confinement.
 */
export function mayRestoreInto(snapshotSpec: string, intoSpec: string): boolean {
  return snapshotSpec === intoSpec
}

/**
 * The stop reason a world reaches when its lifetime ceiling passes.
 *
 * A named function rather than a literal at each call site, so the one place
 * that decides "an expired world is not a failed world" is readable: `timeout`
 * is distinct from `provider-failed` because an operator retries one and
 * investigates the other.
 * @returns the `timeout` reason.
 */
export function lifetimeExceededReason(): WorldStopReason {
  return 'timeout'
}
