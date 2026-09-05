/**
 * Types for the Stage-0 P9 registry-extension generator's pure decisions.
 *
 * Only the helpers the tests exercise are declared, matching the precedent set
 * by `generate-ledger.d.mts`.
 */

/** Split a matrix field's `；`-separated clauses. */
export function splitClauses(value: string | undefined): string[]

/** Parse the `Priority / Wave / 依赖` field. */
export function parsePriorityWave(value: string): {
  priority: string
  wave: number | null
  predecessors: string[]
}

/** Parse the `Files` field into path/kind entries. */
export function parseFiles(value: string): { path: string, kind: string }[]

/**
 * Find the pinned triage document's verbatim line for one P9 item.
 *
 * Returns null when no bullet mentions the item, so the caller fails closed
 * rather than storing a blank verdict.
 */
export function triageLineFor(id: string, triageText: string): string | null
