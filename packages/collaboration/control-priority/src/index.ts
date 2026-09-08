/**
 * What a control message is, and which one wins when several arrive together
 * (Epic P5-10 must[0], must[1]).
 *
 * **One table, because the ordering has two consumers on opposite sides of a
 * dependency.** The subagent control router decides for one child; the agent
 * inbox decides at its dequeue point, which is where messages from every
 * source converge — a router only ever sees what was routed through it, while
 * `steer`, `inject` and `followup` reach an inbox directly from a user, a
 * team, or a goal driver. `dsh-subagent` depends on `dsh-agent`, so the table
 * cannot live in either of them and be reachable from the other.
 *
 * @module @deepseek-ai/dsh-control-priority
 */

/** The five kinds of control message a child can receive (must[0]). */
export type ControlKind = 'continue' | 'steer' | 'inject' | 'cancel' | 'human-answer'

/**
 * Which kinds are PROMOTED ahead of arrival order (must[1]).
 *
 * **Only `cancel`.** must[1]'s "each kind defines a priority" governs conflicts
 * between control DECISIONS — two instructions that cannot both be obeyed —
 * and a cancel is the only kind that must win one regardless of when it
 * arrived: a stop that waited its turn behind the work it stops has not
 * stopped anything.
 *
 * **Everything else keeps arrival order, and `inject` is why (§12.37).**
 * Injected content is not a decision, it is CONTEXT, and moving a
 * later-arriving instruction ahead of context that arrived before it changes
 * what that instruction means. An earlier table ranked all five and reordered
 * a `continue` ahead of an already-arrived `inject`; measured, that reversed
 * two cases in `@deepseek-ai/dsh-experimental-agent-team`, whose expectation —
 * quiet context first, then the follow-up that wakes on it — is the correct
 * reading of both messages.
 *
 * `human-answer` is absent for a different reason: it is positioned by the
 * wait point it answers, so sorting it against unrelated traffic would move an
 * answer away from its question.
 *
 * Arrival order IS the defined winner between two non-cancel kinds. An earlier
 * note argued a total order was needed so two such kinds would not be left to
 * sort stability; that is answered by the comparator's explicit arrival
 * tiebreak, without inventing a second ordering nobody asked for.
 */
const PROMOTED: ReadonlySet<ControlKind> = new Set<ControlKind>(['cancel'])

/**
 * Order items so a promoted kind leads, and everything else keeps the order it
 * arrived in.
 *
 * Generic over the item because the two consumers carry different things: the
 * router orders `ControlMessage`s, the inbox orders queued user messages whose
 * kind was recorded by the operation that inserted them. Both need the same
 * order, and neither should have to convert its item into the other's shape to
 * get it.
 *
 * An item whose kind is `undefined` is ordinary input rather than a control
 * message, and keeps its arrival position like every unpromoted kind. It is
 * not pushed to the back: a queued prompt that arrived before an `inject` is
 * still the earlier message, and reordering the two would change what the
 * model reads without any decision having been made.
 * @param items - the items that arrived together.
 * @param kindOf - the control kind an item carries, or `undefined` for none.
 * @returns the same items, most urgent first; stable within one kind.
 */
export function orderByControlPriority<T>(
  items: readonly T[],
  kindOf: (item: T) => ControlKind | undefined,
): readonly T[] {
  // `map` to index first, so the comparator can fall back to arrival position:
  // `Array.prototype.sort` is specified stable, but relying on that for the
  // "keeps arrival order" half would leave the guarantee implicit in a
  // language rule rather than in the comparator this function is.
  return items
    .map((item, index) => ({ item, index, rank: rankOf(kindOf(item)) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(entry => entry.item)
}

/**
 * The sort rank of one kind: promoted kinds first, everything else at one
 * rank so the comparator's arrival tiebreak decides between them.
 * @param kind - the item's control kind, or `undefined` for ordinary input.
 * @returns a rank; lower sorts first.
 */
function rankOf(kind: ControlKind | undefined): number {
  return kind !== undefined && PROMOTED.has(kind) ? 0 : 1
}
