/**
 * The blackboard: structured facts with provenance (Epic P5-11 must[1]).
 *
 * A blackboard is shared working memory for agents that do not talk directly.
 * The constraint that makes it useful is what it REFUSES to hold: free text.
 * A fact is a structured value or a reference to stored content, and it always
 * names where it came from.
 *
 * The reason is not tidiness. A blackboard whose entries were prose would be a
 * second, unversioned channel for instructions — anything an agent wrote there
 * would reach another agent's context as text, and nothing could distinguish a
 * recorded observation from an injected directive. Requiring structure and
 * provenance means a reader can always ask "who asserted this, and from what".
 *
 * @module @deepseek-ai/dsh-blackboard
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one posted fact. */
export type FactId = Branded<'FactId'>

/** A reference to stored content; the blackboard holds the ref, never the bytes. */
export type ArtifactRef = Branded<'ArtifactRef'>

/** Who posted a fact. */
export type AuthorId = Branded<'AuthorId'>

/**
 * Where a fact came from.
 *
 * `derived` names the facts it was computed from, so a chain can be walked
 * back to observations. `observed` names an external source. The two are
 * separate variants because an empty derivation list and a first-hand
 * observation are different claims, and one nullable field could not tell them
 * apart -- the same split `MemoryProvenance` makes in P6-02.
 */
export type FactProvenance =
  | { readonly kind: 'observed'; readonly source: string }
  | { readonly kind: 'derived'; readonly from: readonly FactId[] }

/**
 * A fact's payload: structured data or a reference. Never free text.
 *
 * `structured` is `Record<string, unknown>` rather than `unknown` so a bare
 * string cannot satisfy it. That is the type-level half of must[1]; the
 * runtime half is `admitFact` below, since a caller can always cast.
 */
export type FactValue =
  | { readonly kind: 'structured'; readonly value: Record<string, unknown> }
  | { readonly kind: 'ref'; readonly artifact: ArtifactRef }

/** One fact on the board. */
export interface Fact {
  readonly id: FactId
  readonly author: AuthorId
  readonly value: FactValue
  readonly provenance: FactProvenance
  /** RFC 3339 UTC instant the fact was posted. */
  readonly postedAt: string
}

/** Why a fact was refused. */
export type FactDenialReason =
  /** The payload is not structured data or a reference. */
  | 'unstructured-value'
  /** A derived fact named no source facts. */
  | 'derived-without-source'
  /** A derived fact names a fact the board does not hold. */
  | 'dangling-provenance'
  /** An observed fact named no source. */
  | 'observed-without-source'

/** The outcome of posting a fact. */
export type FactAdmission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: FactDenialReason }

/**
 * Decide whether a fact may be posted (must[1]).
 *
 * Checks the VALUE at runtime rather than trusting the type, because
 * `Record<string, unknown>` is satisfied by anything a cast can produce, and
 * the clause is about what the board actually holds. A string, an array, and
 * `null` are all refused: an array of strings is as much free text as a
 * string, and admitting it would reopen the channel the structure requirement
 * closes.
 * @param fact - the fact being posted.
 * @param known - facts the board already holds, for provenance resolution.
 * @returns whether the fact may be posted.
 */
export function admitFact(fact: Fact, known: ReadonlySet<FactId>): FactAdmission {
  if (fact.value.kind === 'structured') {
    const value: unknown = fact.value.value
    const structured = typeof value === 'object' && value !== null && !Array.isArray(value)
    if (!structured) return { admitted: false, reason: 'unstructured-value' }
  }
  if (fact.provenance.kind === 'observed') {
    if (fact.provenance.source.length === 0) {
      return { admitted: false, reason: 'observed-without-source' }
    }
    return { admitted: true }
  }
  if (fact.provenance.from.length === 0) {
    return { admitted: false, reason: 'derived-without-source' }
  }
  for (const source of fact.provenance.from) {
    if (!known.has(source)) return { admitted: false, reason: 'dangling-provenance' }
  }
  return { admitted: true }
}

/**
 * Walk a derived fact back to the observations it rests on.
 *
 * Returns the observed facts reachable from `id`. A caller judging a derived
 * conclusion needs its roots, not its immediate inputs: "derived from fact 7"
 * is not an answer if fact 7 was itself derived.
 *
 * A cycle cannot arise, because `admitFact` refuses a derivation naming a fact
 * the board does not yet hold — so provenance only ever points backwards. The
 * visited set here guards against a caller passing a hand-built map that
 * violates that, rather than against anything the board can produce.
 * @param id - the fact to trace.
 * @param facts - every fact on the board, by id.
 * @returns the observed roots, in first-encountered order.
 */
export function traceToObservations(id: FactId, facts: ReadonlyMap<FactId, Fact>): readonly Fact[] {
  const roots: Fact[] = []
  const seen = new Set<FactId>()
  const walk = (current: FactId): void => {
    if (seen.has(current)) return
    seen.add(current)
    const fact = facts.get(current)
    if (fact === undefined) return
    if (fact.provenance.kind === 'observed') {
      roots.push(fact)
      return
    }
    for (const source of fact.provenance.from) walk(source)
  }
  walk(id)
  return roots
}
