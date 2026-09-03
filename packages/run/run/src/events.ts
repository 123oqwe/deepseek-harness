/**
 * Contract-stage RED scaffold for Epic P4-01's append-only Run event log
 * (must[1]). This module owns the log's own mechanics — minting the genesis
 * entry, appending a new entry while leaving every prior one untouched, and
 * querying which entities a log references — separately from
 * `./state-machine.ts`'s state-transition legality table, since a Run event
 * log entry always accompanies a state transition (`RunEvent.fromState`/
 * `toState`) but the append-only guarantee itself (never mutate or drop a
 * prior entry, monotonic `seq`) is a property of the log, not of which
 * transitions happen to be legal.
 *
 * Every exported function below has a real, epic-accurate signature but a
 * placeholder body (`'not implemented'`) — the pure append-only/query logic
 * itself is this epic's Contract-stage deliverable to a later fix-round, not
 * this scaffold's, matching `@deepseek-ai/dsh-plugin-ownership`'s own
 * Contract-stage convention.
 *
 * @module @deepseek-ai/dsh-run/events
 */

import type { Run, RunEntityKind, RunEntityReference, RunEvent, RunId, RunState } from './types.ts'

/**
 * must[1]'s log-genesis entry point: the first {@link RunEvent} a newly
 * accepted Run's log ever carries, with no prior state (`fromState: null`).
 * `./state-machine.ts`'s `createRun` is this function's only caller.
 * @param runId - the Run this genesis entry belongs to.
 * @param initialState - the Run's first state (always `'accepted'` from
 * `createRun`, but this function does not itself enforce that — `createRun` does).
 * @param references - entities the Run's acceptance already names (for
 * example, the initiating Session), possibly empty.
 * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this entry is stamped with.
 * @returns the Run's first {@link RunEvent}, at `seq` `0`.
 */
export function genesisRunEvent(
  runId: RunId,
  initialState: RunState,
  references: readonly RunEntityReference[],
  occurredAt: number,
): RunEvent {
  throw new Error(`not implemented: genesisRunEvent(${String(runId)}, ${initialState}, ${String(references.length)} references, ${String(occurredAt)})`)
}

/**
 * must[1]'s append-only entry point: return a new event array containing
 * every entry `run.events` already carries, unchanged and in order, plus
 * exactly one new entry recording `run.state -> toState` at the next
 * monotonic `seq`. Never mutates, reorders, or removes an existing entry —
 * the log's append-only guarantee. `./state-machine.ts`'s `transition` is
 * this function's only caller, after confirming `run.state -> toState` is
 * legal.
 * @param run - the Run whose log gains one entry; `run.events`/`run.state`/`run.id` supply the prior log, `fromState`, and `runId`.
 * @param toState - the state this new entry records the Run moving to.
 * @param references - entities this transition names (must[1]'s Session/Workflow/Action/Artifact/Approval/Verification), possibly empty.
 * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this entry is stamped with.
 * @returns `run.events` with exactly one new entry appended.
 */
export function appendRunEvent(
  run: Run,
  toState: RunState,
  references: readonly RunEntityReference[],
  occurredAt: number,
): readonly [RunEvent, ...RunEvent[]] {
  throw new Error(`not implemented: appendRunEvent(${String(run.id)}, ${run.state} -> ${toState}, ${String(references.length)} references, ${String(occurredAt)})`)
}

/**
 * must[1]'s reference-query entry point: every {@link RunEntityReference} of
 * `kind`, across every entry in `events`, in log order. Used to answer "does
 * this Run's log reference Approval X" or "list every Artifact this Run's
 * log names" without a caller re-implementing the log walk.
 * @param events - a Run's complete event log (or a prefix/slice of one).
 * @param kind - which of the six must[1] entity kinds to extract.
 * @returns every matching reference, in the order its owning entry appears in `events`.
 */
export function referencesByKind(events: readonly RunEvent[], kind: RunEntityKind): readonly RunEntityReference[] {
  throw new Error(`not implemented: referencesByKind(${String(events.length)} events, ${kind})`)
}
