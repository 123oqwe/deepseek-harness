/**
 * Types shared by job producers, the registry, and controllers. The
 * service implementation lives in `./index.ts`.
 * @module @deepseek-ai/dsh-jobs/types
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JobId } from './brand.ts'

export { JobId } from './brand.ts'

/**
 * Task lifecycle: `running`, optionally `stopping`, then exactly one terminal
 * status. Producer-specific facts belong in {@link JobSnapshot.detail}.
 */
export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

/**
 * Whether a status is one a job never leaves.
 *
 * Declared beside {@link JobStatus} because every consumer that branches on
 * settlement needs the same three values, and a second list of them drifts
 * from the union it is a subset of.
 * @param status - the status to classify.
 * @returns `true` for `completed`, `killed` and `failed`.
 */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'killed' || status === 'failed'
}

/**
 * Producer-defined job kinds. Plugins extend this map by declaration merging;
 * the registry treats every value as an opaque id namespace.
 */
export interface JobKindMap {
  bash: 'bash'
  subagent: 'subagent'
}

/** The merge-extensible union of registered producer kind names. */
export type JobKind = JobKindMap[keyof JobKindMap]

/** Terminal result supplied by a producer through {@link JobHooks.done}. */
export interface JobOutcome {
  /** How the job ended: finished (`completed`), cancelled (`killed`), or broke (`failed`). */
  status: 'completed' | 'killed' | 'failed'
  /** Kind-specific detail rendered into status lines ('exit code: 3', 'max-tokens'). */
  detail?: string
  /** Final output for jobs without `readOutput`; stream jobs leave it unset. */
  output?: string
}

/**
 * Producer declaration passed to {@link JobRegistry.start}. The runtime
 * preflights access and cleanup before invoking {@link run}; the producer owns
 * execution resources while the runtime owns identity and lifecycle state.
 */
export interface JobStart {
  /** Producer kind — also the id prefix (`bash`, `subagent`, …). */
  kind: JobKind
  /** One-line model-facing label (the command; the delegation description). */
  label: string
  /**
   * Optional UTF-8 byte cap for each complete model-facing completion notice or
   * output read, including controller status metadata.
   */
  outputLimitBytes?: number
  /**
   * Owning live agent. Access is fenced by its session id, and agent disposal
   * cancels and awaits the job. The instance must be the one currently
   * registered under its agent id. Omitting the owner creates an unowned job,
   * open to any caller until service disposal.
   */
  owner?: Agent
  /**
   * Start the work after preflight and synchronously return its hooks. Called
   * once; a throw leaves nothing registered, and the producer must clean up any
   * partially started resources.
   */
  run(): JobHooks
}

/** Hooks through which the runtime controls and observes producer work. */
export interface JobHooks {
  /**
   * Request termination. Must be synchronous, idempotent, and eventually settle
   * {@link done}; throws propagate. The optional reason is forwarded verbatim.
   */
  cancel(reason?: string): void
  /**
   * Resolves after the producer releases its resources, not merely when work
   * finishes. Must not reject; the runtime converts a rejection to `failed`.
   * If teardown cancellation throws, the runtime may force-fail only the
   * registry record without claiming that the work stopped.
   */
  done: Promise<JobOutcome>
  /**
   * Consume output produced since the previous call. The producer formats
   * truncation and spill notices. Absence marks a final-output-only job; each
   * job has one consuming cursor.
   */
  readOutput?(): string
}

/**
 * A read-only projection of one job, safe to hand to listeners and tools —
 * a fresh object per call, never live registry state.
 */
export interface JobSnapshot {
  /** The registry-issued id (`<kind>-N`). */
  id: JobId
  /** The producer kind the job was registered with. */
  kind: JobKind
  /** The producer-supplied one-line label. */
  label: string
  /** Producer-owned cap for complete model-facing notices and output reads. */
  outputLimitBytes?: number
  /**
   * Owner session id used for authorization and correlation; absent for
   * unowned jobs. Completion listeners receive the exact {@link Agent}
   * separately through {@link JobDoneListener}.
   */
  ownerSession?: SessionId
  /** Current lifecycle state. */
  status: JobStatus
  /** Kind-specific status detail, present once the producer supplied one (usually terminal). */
  detail?: string
  /** Epoch ms when the job was registered. */
  startedAt: number
  /** Epoch ms when the job settled; absent while `running`/`stopping`. */
  finishedAt?: number
  /**
   * True when a kill, read, wait, or teardown cancel has reported or committed
   * to report the terminal state. Completion reporters suppress redundant
   * notices when set. Teardown claims it because the owner or service being
   * destroyed leaves no reader: a reporter that opens a turn on notice would
   * otherwise spend a model request per teardown layer.
   */
  reported: boolean
}

/** Output and post-read state returned by {@link JobRegistry.read}. */
export interface JobRead {
  /**
   * Stream kinds: the consuming delta since the previous read. Final-output
   * kinds: empty while live, the terminal {@link JobOutcome.output} (or
   * empty) once settled — idempotent, never consumed.
   */
  text: string
  /** The job's state at read time. */
  snapshot: JobSnapshot
}

/**
 * Completion callback with the exact owner supplied at start, or `undefined`
 * for an unowned job. Returned promises are observed but not awaited.
 */
export type JobDoneListener = (
  snapshot: JobSnapshot,
  owner: Agent | undefined,
) => void | PromiseLike<void>

/**
 * Observation callback for a change to what one owner's {@link JobRegistry.list}
 * would return. It is owner-granular rather than job-granular because the
 * change may be a removal, which no per-job record can express, and because
 * its consumers re-read the whole visible set anyway.
 *
 * An `undefined` owner means an unowned job changed, so every caller's visible
 * set changed with it.
 */
export type JobsChangedListener = (owner: Agent | undefined) => void

/**
 * Which run-ending surface abandoned a job. Both are one-shot surfaces that
 * tear down after their agent goes idle; a long-lived surface ends a turn
 * rather than a process, so a late completion still reaches a later turn and
 * nothing is abandoned.
 */
export type AbandonedJobSurface = 'headless' | 'subagent'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A background job this session started was still running when the run
     * ended, so its output reached nobody (BLOCKED-220).
     *
     * A run's completion condition is its agent going idle, which a live job
     * is not part of. The registry's teardown then cancels each remaining job
     * and marks it reported — deliberately, because a disposing owner must not
     * be woken — so without this event the log shows a job that was started,
     * accepted and reported, and no record that its result went nowhere.
     *
     * Appended AFTER the turn has ended and with no surface metadata, so it
     * reaches no model request: the run has already produced its answer, and
     * this is an operator fact about it rather than an input to it. The
     * headless surface projects one stderr line per event, which is how a
     * caller — the only party still listening — learns the work was dropped.
     *
     * One event per abandoned job rather than one per run: a caller chasing a
     * dropped result needs the id it was given, and a count cannot supply it.
     */
    'job/abandoned': {
      /** The registry-issued id the model was told to track (`<kind>-N`). */
      jobId: string
      /** The job's non-terminal status at the moment the run ended. */
      status: 'running' | 'stopping'
      /** The run-ending surface that abandoned it. */
      surface: AbandonedJobSurface
    }
  }
}
