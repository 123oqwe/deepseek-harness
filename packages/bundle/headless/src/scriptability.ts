/**
 * Scriptable headless runs: where the task comes from, and what the exit code
 * means (Epic P9-06, Contract stage).
 *
 * A headless run driven by a script is judged by two things a human run is not:
 * whether the task can be piped in, and whether the process exit code is a
 * reliable signal. Both are decisions rather than plumbing, so they are defined
 * here as pure functions the runner will consult.
 *
 * Contract stage only. `--resume` reuses the session layer's existing resume
 * semantics and `stream-json` must match the SDK's recorded line format, so both
 * are wiring against artifacts outside this module and belong to the Provider
 * and Usage stages.
 *
 * @module @deepseek-ai/dsh-bundle-headless/scriptability
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** How a run's task text was supplied. */
export type TaskSource =
  | { readonly kind: 'argument'; readonly task: string }
  | { readonly kind: 'stdin'; readonly task: string }

/** Why a run could not determine its task. */
export type TaskInputDenial =
  /** Both a positional task and piped stdin were supplied. */
  | { readonly reason: 'ambiguous-input'; readonly detail: string }
  /** Neither was supplied. */
  | { readonly reason: 'no-input'; readonly detail: string }
  /** Input was supplied but contains no task. */
  | { readonly reason: 'empty-input'; readonly detail: string }

/** The outcome of resolving where a run's task came from. */
export type TaskInputOutcome =
  | { readonly resolved: true; readonly source: TaskSource }
  | { readonly resolved: false; readonly denial: TaskInputDenial }

/**
 * Decide which input carries the task (must[2]).
 *
 * A positional argument and piped stdin are MUTUALLY EXCLUSIVE rather than
 * ranked. Preferring one silently would run a task the caller did not intend
 * while their other input vanished, and a script that accidentally supplies
 * both has a bug its author needs told about — precedence would hide it for as
 * long as the two happened to agree.
 *
 * Whitespace-only input is refused rather than sent as a task: it is what a
 * failed upstream command produces, and running an empty prompt spends a model
 * call to learn nothing.
 * @param positional - the task given as an argument, when present.
 * @param stdin - text piped in, when present. `undefined` means stdin was a TTY or empty.
 * @returns the resolved source, or why it could not be resolved.
 */
export function resolveTaskInput(positional: string | undefined, stdin: string | undefined): TaskInputOutcome {
  const hasPositional = positional !== undefined
  const hasStdin = stdin !== undefined
  if (hasPositional && hasStdin) {
    return {
      resolved: false,
      denial: {
        reason: 'ambiguous-input',
        detail: 'a task was given both as an argument and on stdin; supply exactly one',
      },
    }
  }
  if (!hasPositional && !hasStdin) {
    return {
      resolved: false,
      denial: { reason: 'no-input', detail: 'no task given: pass one as an argument or pipe it on stdin' },
    }
  }
  const raw = (hasPositional ? positional : stdin) as string
  if (raw.trim().length === 0) {
    return {
      resolved: false,
      denial: {
        reason: 'empty-input',
        detail: hasPositional ? 'the task argument is empty' : 'stdin contained no task text',
      },
    }
  }
  return { resolved: true, source: { kind: hasPositional ? 'argument' : 'stdin', task: raw } }
}

/** A machine-routable reason a run did not complete, carried in the JSON output. */
export type RunFailureCode =
  | 'blocked'
  | 'aborted'
  | 'error'
  | 'max-tokens'
  | 'interrupted'
  | 'unknown'

/** What a script learns from a finished run. */
export interface RunExitStatus {
  /** 0 only when the run completed; every other outcome is non-zero (must[3]). */
  readonly exitCode: number
  /** Absent when the run completed; otherwise the typed reason for the JSON output. */
  readonly failure: RunFailureCode | undefined
}

/** The distinct non-zero exit code each failure class reports. */
const EXIT_CODES: Record<RunFailureCode, number> = {
  blocked: 2,
  aborted: 3,
  error: 4,
  'max-tokens': 5,
  interrupted: 6,
  unknown: 1,
}

/**
 * Map a run's outcome to a process exit code and a typed reason (must[3]).
 *
 * Every non-completion is non-zero, and each class gets its OWN code, so a
 * script can branch on the difference between "the model was blocked" and "the
 * request errored" without parsing output. Collapsing them to a single 1 would
 * make the exit code report only that something went wrong, which a script
 * cannot act on.
 *
 * An ABSENT reason maps to `unknown` and exit 1, never to success. A run whose
 * turn never ended did not complete, and treating a missing signal as completion
 * is how a broken pipeline reports green.
 * @param reason - the run's `turn/end` reason, when one was recorded.
 * @returns the exit code and the typed failure, if any.
 */
export function exitStatusFor(reason: SessionEvent<'turn/end'>['data']['reason'] | undefined): RunExitStatus {
  if (reason === undefined) return { exitCode: EXIT_CODES.unknown, failure: 'unknown' }
  if (reason.kind === 'completed') return { exitCode: 0, failure: undefined }
  const known: RunFailureCode = reason.kind === 'blocked'
    || reason.kind === 'aborted'
    || reason.kind === 'error'
    || reason.kind === 'max-tokens'
    || reason.kind === 'interrupted'
    ? reason.kind
    // A reason this build does not know is still a non-completion. Reporting it
    // as `unknown` keeps the exit code non-zero rather than letting a newer
    // TurnEndReason member fall through to success.
    : 'unknown'
  return { exitCode: EXIT_CODES[known], failure: known }
}
