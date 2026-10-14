/**
 * Names and the report fields the P4-09 nested-run driver and the spec beside it
 * share. The driver observes acceptance[1] (a parent's cancellation propagates)
 * and acceptance[2] (a child failure is handled by the declared policy) on the
 * SHIPPED headless composition, where blind review 1-2 found only hand-built
 * contexts (BLOCKED-312 [1][2], acceptance standard S3).
 * @module tests/first100/fixtures/loader/p4-09-nested-shipped/shared
 */

/** The line prefix the spec parses the driver's JSON report from. */
export const REPORT_PREFIX = 'P4-09-NESTED-SHIPPED'

/** The `workflow` tool the root agent calls (shipped `tool-workflow`). */
export const WORKFLOW_TOOL = 'workflow'

/** A saved definition whose body throws, so its nested run fails. */
export const BOOM_NAME = 'p409s3-boom'

/** The message the failing definition throws. */
export const BOOM_MESSAGE = 'p409s3 child boom'

/** A saved definition that starts one agent and then never returns. */
export const LIVE_NAME = 'p409s3-live'

/** A saved definition that starts one agent and returns {@link INFLIGHT_VALUE}. */
export const INFLIGHT_NAME = 'p409s3-inflight'

/** What {@link INFLIGHT_NAME} returns when its body runs to the end. */
export const INFLIGHT_VALUE = 'P409S3 inflight ran'

/** What the continue-parent script returns once the failing nested call is behind it. */
export const PARENT_CONTINUED = 'P409S3 parent completed'

/** The prompt {@link LIVE_NAME} passes to `agent()`; the scripted model routes by it. */
export const LIVE_CHILD_PROMPT = 'P409S3_CHILD_LIVE'

/** The prompt {@link INFLIGHT_NAME} passes to `agent()`; the scripted model routes and counts by it. */
export const INFLIGHT_CHILD_PROMPT = 'P409S3_CHILD_INFLIGHT'

/** One `workflow` tool call whose result the model reads. */
export interface ToolOutcome {
  /** Guard: the root agent's `workflow` call has a result in its session log. */
  readonly dispatched: boolean
  /** The result text the log recorded for that call. */
  readonly resultText: string
}

/**
 * What the root session and the scripted model saw during the [2] ① turn. It tells a
 * `workflow` call that was never made from a call that never settled into a
 * result, and from a result the driver did not read.
 */
export interface FailDefaultProbe {
  /** `tool/call` events in the root session with this case's call id. */
  readonly toolCalls: number
  /** `tool/result` events whose tool-result block carries this case's call id. */
  readonly toolResults: readonly {
    readonly isError: boolean
    /** The block's content part types, in order. */
    readonly partTypes: readonly string[]
    /** The failure identity the event recorded, as JSON, when it recorded one. */
    readonly error?: string
  }[]
  /** How this case's outer workflow run ended (`workflow/end`), or `none` when no end was observed. */
  readonly outerEnd: string
  /** Every model request during the turn, in order. */
  readonly requests: readonly {
    /** The role of the request's last message. */
    readonly lastRole: string
    /** That message's source, as JSON. */
    readonly lastSource: string
    /** The start of that message's text. */
    readonly lastText: string
    /** What the scripted model answered: `tool-call <name>`, or the text it returned. */
    readonly answered: string
  }[]
}

/** What one driver run observed. */
export interface NestedShippedReport {
  /** [2] ①: no strategy declared. */
  readonly failDefault: ToolOutcome & { readonly probe: FailDefaultProbe }
  /** [2] ②: `onFailure: 'continue-parent'` declared on the call. */
  readonly continueParent: ToolOutcome & {
    /** The `workflow/log` lines the parent run emitted; continue-parent still records the child's failure. */
    readonly parentLogs: readonly string[]
  }
  /** [1] control: the same gated nested start as {@link inflightCancelled}, released with no cancel. */
  readonly inflightControl: ToolOutcome & {
    /** Whether the driver's gate held the nested start before releasing it. */
    readonly parked: boolean
    /** How many model requests carried {@link INFLIGHT_CHILD_PROMPT} during this turn. */
    readonly childServed: number
  }
  /** [1]: the root agent is cancelled while the nested start is held in flight. */
  readonly inflightCancelled: {
    readonly parked: boolean
    readonly childServed: number
    /** `workflow/agent-start` events of the nested run during this turn. */
    readonly nestedAgentStarts: number
    /** How the parent run ended (`workflow/end`), or `none` when no end was observed. */
    readonly parentEnd: string
  }
  /** [1]: the root agent is cancelled while a nested run and the agent it started are live. */
  readonly liveCancelled: {
    /** Guard: the nested run started and its agent started before the cancel. */
    readonly nestedStarted: boolean
    readonly nestedAgentStarted: boolean
    /** The nested run's own settlement read from its handle, or `did-not-settle` within the bound. */
    readonly nestedSettled: string
    /** `workflow/agent-start` and `workflow/agent-end` events of the nested run. */
    readonly agentStarts: number
    readonly agentEnds: number
    readonly parentEnd: string
  }
}
