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
 * Relative urgency when several messages arrive together (must[1]).
 *
 * `cancel` outranks everything. The race acceptance[0] names — a `steer` or
 * `continue` arriving at the same moment as a `cancel` — is decided here
 * rather than by arrival order, because arrival order is a property of the
 * transport and would make the outcome depend on scheduling.
 *
 * A total order over all five, not a cancel-first special case: two messages
 * of different non-cancel kinds also need a defined winner, and a comparator
 * that only knew about `cancel` would leave the rest to sort stability, which
 * is the same scheduling dependence one level down.
 */
const PRIORITY_BY_KIND: Record<ControlKind, number> = {
  cancel: 0,
  'human-answer': 1,
  steer: 2,
  continue: 3,
  inject: 4,
}

/**
 * Order items by the urgency of the control kind each carries, keeping arrival
 * order within one kind.
 *
 * Generic over the item because the two consumers carry different things: the
 * router orders `ControlMessage`s, the inbox orders queued user messages whose
 * kind was recorded by the operation that inserted them. Both need the same
 * order, and neither should have to convert its item into the other's shape to
 * get it.
 *
 * An item whose kind is `undefined` sorts AFTER every control message and
 * keeps its arrival position among the others. Ordinary input is not a control
 * message, and giving it a rank would mean deciding that some user text
 * outranks a cancel.
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
 * The sort rank of one kind, with `undefined` after every control kind.
 * @param kind - the item's control kind, or `undefined`.
 * @returns a rank; lower sorts first.
 */
function rankOf(kind: ControlKind | undefined): number {
  return kind === undefined ? Number.MAX_SAFE_INTEGER : PRIORITY_BY_KIND[kind]
}
