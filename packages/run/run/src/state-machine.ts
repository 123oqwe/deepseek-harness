/**
 * Epic P4-01's first-class Run Service decisions:
 * the legal Run-state-transition table (must[0]/acceptance[1]), Run creation
 * and service-owned identity (must[2]), Session/Run association
 * (acceptance[2]), and restart-time listing/resumption of non-terminal Runs
 * (acceptance[0]).
 *
 * `LEGAL_RUN_TRANSITIONS`, `TERMINAL_RUN_STATES`, and `RUN_SERVICE_OWNER_ID`
 * are exported data a caller may check its own expectations against;
 * `createRun`, `transition`, `attachSessionToRun`, `listNonTerminalRuns`,
 * and `resumeRun` are the pure decisions over them.
 *
 * None of these functions read a file, spawn a process, or construct a
 * Cordis `Context`; every timestamp is caller-supplied so construction stays
 * pure. `packages/run/run/src/index.ts` wires them into the durable Run
 * registry (`RunService`) and into the Cordis plugin that opens a Run for a
 * real agent session.
 *
 * @module @deepseek-ai/dsh-run/state-machine
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { RunId } from '@deepseek-ai/dsh-principal/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { appendRunEvent, genesisRunEvent } from './events.ts'
import type {
  Run,
  RunEntityReference,
  RunOwnerId,
  RunResumeDecision,
  RunState,
  RunTransitionDecision,
} from './types.ts'

/**
 * must[0]/acceptance[1]'s complete legal-transition table: for each
 * {@link RunState}, exactly the states a Run in it may legally move to next.
 * The three terminal states (`succeeded`, `failed`, `cancelled`) map to an
 * empty list — no legal transition ever leaves a terminal Run.
 * `./state-machine.ts`'s `transition` accepts a `(from, to)` pair iff `to`
 * appears in `LEGAL_RUN_TRANSITIONS[from]`; every other pair — including
 * every self-transition, since no state lists itself — is refused
 * fail-closed with `'illegal-transition'`.
 */
export const LEGAL_RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  accepted: ['planning', 'cancelled'],
  planning: ['waiting', 'running', 'failed', 'cancelled'],
  waiting: ['running', 'failed', 'cancelled'],
  running: ['paused', 'verifying', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  verifying: ['succeeded', 'reconciling', 'failed'],
  reconciling: ['running', 'succeeded', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
}

/**
 * acceptance[0]'s terminal-state set, derived from {@link LEGAL_RUN_TRANSITIONS}:
 * every {@link RunState} with no legal outgoing transition. `listNonTerminalRuns`
 * and `resumeRun` decide "non-terminal"/"already-terminal" against this set.
 */
export const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set(
  (Object.keys(LEGAL_RUN_TRANSITIONS) as RunState[]).filter(state => LEGAL_RUN_TRANSITIONS[state].length === 0),
)

/**
 * must[2]'s one and only Run owner: the Run Service's own fixed identity.
 * `createRun` stamps every {@link Run.ownerId} with exactly this constant —
 * there is no parameter through which a caller (a UI session, a request's
 * "current turn") could supply a different value.
 */
export const RUN_SERVICE_OWNER_ID: RunOwnerId = brandString<RunOwnerId>('dsh-run-service')

/**
 * must[0]/must[2]'s Run-acceptance entry point: mint a new Run in its
 * initial `'accepted'` state, owned by {@link RUN_SERVICE_OWNER_ID}, seeded
 * with one initiating Session (acceptance[2]) and its genesis log entry
 * (must[1], via `./events.ts`'s `genesisRunEvent`). Accepts no owner
 * parameter — must[2]'s guarantee that a Run is never owned by a UI session
 * or turn holder holds structurally, not by convention.
 * @param id - the new Run's identity.
 * @param initialSessionId - the Session that requested this Run; becomes `sessionIds[0]`.
 * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this Run is accepted at.
 * @returns the newly accepted {@link Run}.
 */
export function createRun(id: RunId, initialSessionId: SessionId, occurredAt: number): Run {
  const initialReferences: readonly RunEntityReference[] = [{ kind: 'session', id: initialSessionId }]
  return {
    id,
    state: 'accepted',
    ownerId: RUN_SERVICE_OWNER_ID,
    sessionIds: [initialSessionId],
    createdAt: occurredAt,
    events: [genesisRunEvent(id, 'accepted', initialReferences, occurredAt)],
  }
}

/**
 * must[0]/acceptance[1]'s state-transition entry point: advance `run` to
 * `to` when `LEGAL_RUN_TRANSITIONS[run.state]` includes it, appending one
 * new event (`./events.ts`'s `appendRunEvent`) that carries `references`
 * (must[1]); refuse fail-closed, naming the exact rejected pair, otherwise —
 * including every self-transition and every transition attempted from a
 * terminal `run.state`, since {@link TERMINAL_RUN_STATES} members list no
 * legal outgoing transition.
 * @param run - the Run to transition.
 * @param to - the state `run` is asked to move to.
 * @param references - entities this transition names (must[1]), possibly empty.
 * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this transition is stamped with.
 * @returns `{ accepted: true, run }` with the advanced Run, or `{ accepted: false, reason, from, to }`.
 */
export function transition(
  run: Run,
  to: RunState,
  references: readonly RunEntityReference[],
  occurredAt: number,
): RunTransitionDecision {
  if (!LEGAL_RUN_TRANSITIONS[run.state].includes(to)) {
    return { accepted: false, reason: 'illegal-transition', from: run.state, to }
  }
  return {
    accepted: true,
    run: { ...run, state: to, events: appendRunEvent(run, to, references, occurredAt) },
  }
}

/**
 * acceptance[2]'s Session-association entry point: return a Run identical
 * to `run` except `sessionIds` gains `sessionId` — proving a Run can span
 * multiple Sessions/Agents. Idempotent: attaching a `sessionId` already
 * present in `run.sessionIds` returns `run`'s session list unchanged rather
 * than a duplicate entry.
 * @param run - the Run to associate an additional Session with.
 * @param sessionId - the Session/Agent to add.
 * @returns a Run whose `sessionIds` contains every id `run.sessionIds` already had, plus `sessionId` if it was not already present.
 */
export function attachSessionToRun(run: Run, sessionId: SessionId): Run {
  if (run.sessionIds.includes(sessionId)) return run
  return { ...run, sessionIds: [...run.sessionIds, sessionId] }
}

/**
 * acceptance[0]'s restart-listing entry point: every Run in `runs` whose
 * `state` is not one of {@link TERMINAL_RUN_STATES} — the complete set a
 * process restart must list and offer for resumption.
 * @param runs - every Run a durable Run registry has on record (this epic's
 * Provider-stage `packages/run/run/src/index.ts` supplies this from real
 * storage; this function itself performs no I/O).
 * @returns exactly the non-terminal Runs in `runs`, in the order given.
 */
export function listNonTerminalRuns(runs: readonly Run[]): readonly Run[] {
  return runs.filter(run => !TERMINAL_RUN_STATES.has(run.state))
}

/**
 * acceptance[0]'s restart-resumption entry point: re-affirm a non-terminal
 * Run's service ownership (must[2]) so it is resumable, or refuse when
 * `run.state` already reached a terminal state — a completed Run is never
 * resumed back into activity.
 * @param run - a Run `listNonTerminalRuns` listed as non-terminal (or any
 * other Run to check).
 * @returns `{ resumed: true, run }` with `run.ownerId` re-affirmed as
 * {@link RUN_SERVICE_OWNER_ID}, or `{ resumed: false, reason: 'already-terminal' }`.
 */
export function resumeRun(run: Run): RunResumeDecision {
  if (TERMINAL_RUN_STATES.has(run.state)) {
    return { resumed: false, reason: 'already-terminal' }
  }
  return { resumed: true, run: { ...run, ownerId: RUN_SERVICE_OWNER_ID } }
}
