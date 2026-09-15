/**
 * Types for `verify-make-vs-use.mjs`: the findings `generate-ledger.mjs --accept` reads.
 */

import type { DeliverablePathPatch } from './files-overlay.d.mts'

/** One make-vs-use finding, with the epic whose record it concerns. */
export interface MakeVsUseFinding {
  epic: string
  text: string
}

/** This gate's inputs as read from disk; the record fields are those of its JSON files. */
export interface MakeVsUseInputs {
  rows: Map<string, unknown>
  registry: Map<string, unknown>
  preFlight: Record<string, unknown>
  freeze: readonly unknown[]
  patches: readonly DeliverablePathPatch[]
  execRows: Record<string, unknown>
}

export function loadMakeVsUseInputs(): MakeVsUseInputs

export function makeVsUseFindings(inputs: MakeVsUseInputs): {
  findings: MakeVsUseFinding[]
  pending: string[]
  outside: string[]
  states: [string, string][]
  /** Where the import scan found a known import; `undefined` when it found none. */
  control: string | undefined
}
