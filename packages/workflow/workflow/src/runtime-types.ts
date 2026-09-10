/**
 * Host-only workflow request and live-run handles. The browser-safe durable
 * vocabulary remains in `./types` so Client programs never import Agent or
 * host Cordis context declarations.
 *
 * @module @deepseek-ai/dsh-workflow
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  WorkflowMeta, WorkflowResult, WorkflowRunId,
} from './types.ts'

/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
export interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
  /**
   * An opaque trace context this run carries and passes to everything it
   * nests (P4-09 must[3]).
   *
   * OPAQUE deliberately. P7-07 owns tracing and will decide what a trace
   * context contains; this epic owns only the rule that a nested or detached
   * run inherits its parent's rather than starting a new one, which is the
   * §12.46-B split already applied to P4-11's `hedged` and P4-08's `inputs`.
   * Giving it a shape here would be inventing a producer so that this clause
   * has a subject.
   *
   * Absent means the caller carries no trace, which is not the same as an
   * empty one: a run under no trace must not manufacture one, or every
   * un-traced run becomes its own root when tracing lands.
   */
  traceContext?: string
}

/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
export interface WorkflowRun {
  readonly id: WorkflowRunId
  /**
   * The opaque trace context this run carries (P4-09 must[3]).
   *
   * Exposed so propagation is OBSERVABLE: a context threaded internally and
   * visible nowhere could be dropped between a parent and its nested child
   * without any case noticing.
   *
   * `string | undefined` rather than optional: under
   * `exactOptionalPropertyTypes` an absent property and an explicit
   * `undefined` are different types, and a run always HAS this field — it is
   * the value that may be absent.
   */
  readonly traceContext: string | undefined
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  dispose(): Promise<void>
}
