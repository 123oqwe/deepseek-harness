/**
 * Types for `matrix-parse.mjs`: the pinned planning matrix parser.
 */

/** The canonical field keys the parser groups `- **Label：**value` lines into. */
export type MatrixFieldKey = 'priorityWave' | 'files' | 'must' | 'nonGoal' | 'acceptance' | 'validation' | 'verifyCommand' | 'realTask' | 'specGap' | 'primaryLayer'

/** One parsed epic block. */
export interface MatrixEntry {
  title: string
  /** 1-based line of the `### P#-## — Title` header. */
  line: number
  fields: Partial<Record<MatrixFieldKey, string>>
}

/**
 * Parse a matrix-format document (`### P#-## — Title` headers, then `- **Label：**value` fields) into `id -> entry`, in document order.
 * @param text - the document text.
 * @returns every parsed epic by id.
 */
export function parseMatrixText(text: string): Map<string, MatrixEntry>
