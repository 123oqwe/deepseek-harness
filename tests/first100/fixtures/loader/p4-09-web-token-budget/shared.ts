/**
 * Names and the report fields the P4-09 Web token-budget driver and the spec
 * beside it share. Blind review U-2: on the Web app, the workflow engine runs in
 * each preset's `isolate: { workflowEngine, savedWorkflows }` delegation group;
 * if that engine cannot read token-meter's `tokenUsage` projection it only warns
 * once and meters nothing (packages/workflow/workflow-worker-thread/src/host.ts,
 * `debitTokens`), and acceptance[3]'s total token budget is not in effect there.
 * @module tests/first100/fixtures/loader/p4-09-web-token-budget/shared
 */

/** The line prefix the spec parses the driver's JSON report from. */
export const REPORT_PREFIX = 'P4-09-WEB-TOKBUD'

/** The `workflow` tool the preset agent calls (the shipped `standard` preset's `tool-workflow`). */
export const WORKFLOW_TOOL = 'workflow'

/** The sentinel in each child's prompt; the scripted model routes and counts children by it. */
export const CHILD_SENTINEL = 'P409U2_CHILD'

/**
 * The input tokens each child response reports: above the engine's shipped
 * default tree allowance (`maxNestedTokens`, 1,000,000), so one response spends it.
 */
export const CHILD_INPUT_TOKENS = 1_200_000

/** What the single run observed. */
export interface WebTokenBudgetReport {
  /** Guard: the agent was composed from the shipped `standard` preset. */
  readonly presetComposed: boolean
  /** Guard: the composed agent is offered the `workflow` tool. */
  readonly workflowToolOffered: boolean
  /** Guard: the composition root publishes no workflow engine, so the run used the preset group's engine. */
  readonly rootEngineAbsent: boolean
  /** Guard: the agent's `workflow` call has a result in its session log. */
  readonly workflowDispatched: boolean
  /** The `workflow` tool result text. */
  readonly resultText: string
  /** How many model requests the first child and the second child were served. */
  readonly firstServed: number
  readonly secondServed: number
}
