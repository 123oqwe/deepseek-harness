/**
 * Types for gate (e)'s pure standards decision.
 *
 * The verifier itself is a `.mjs` script run from the command line; only the
 * part its tests exercise is declared here, matching the precedent set by
 * `generate-ledger.d.mts` and `verify-p9-cells.d.mts`.
 */

/** One epic's `makeVsUse` pre-flight record, in the fields this decision reads. */
export interface MakeVsUseRecord {
  /** Standards this epic fixes, as a bare name or `{ standard, … }`. */
  readonly standardsOwned?: readonly (string | { readonly standard?: string })[]
  /** Standards inherited from a named source; the object form also carries `from`. */
  readonly standardsImported?: readonly (string | { readonly standard?: string; readonly from?: string })[]
  /**
   * What this epic did NOT take. An adapt package is named by `name` (with
   * `npm`); a STANDARD is named by `standard`. The two keys mark two kinds of
   * subject, not two spellings of one.
   */
  readonly deviations?: readonly { readonly standard?: string; readonly name?: string }[]
}

/** One row of `standards-ownership.json`, generated from the plan. */
export interface AssignedStandard {
  readonly standard: string
  /** Whether the plan makes THIS epic answerable for the vocabulary. */
  readonly thisEpicOwns?: boolean
}

/**
 * Which of an epic's carded or assigned standards its record leaves
 * undisclosed.
 *
 * An assigned standard is claimed two ways and both are claims: adopted and
 * named by a live frozen case, or measured as not adopted and recorded in
 * `deviations`. Ownership means "if this vocabulary appears in the tree, this
 * epic is answerable for it" — never an obligation to adopt.
 * @param standards - the standards this epic's make-vs-use card names.
 * @param declared - the epic's `makeVsUse` pre-flight record.
 * @param assigned - `standards-ownership.json`'s rows for this epic.
 * @returns one message per undisclosed standard; empty when all are dispositioned.
 */
export function standardDispositionGaps(
  standards: readonly string[],
  declared: MakeVsUseRecord,
  assigned: readonly AssignedStandard[],
): string[]
