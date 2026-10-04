/**
 * Names and the report shape the A-608 token-budget driver and the spec beside
 * it share. A-608 is the red-first for B-714 under P4-09 acceptance[3]: a RUNNING
 * in-process nested child that overspends its tree's token allowance is aborted
 * mid-run with `token-budget-exhausted`. Today the host checks the token budget
 * only when a child STARTS (host.ts:520) and debits it only AFTER a child settles
 * (host.ts:667), so a child that overspends during its run is never aborted — it
 * runs to completion.
 * @module tests/first100/fixtures/loader/a-608-token-budget-midrun/shared
 */

/** The line prefix the spec parses the driver's JSON report from. */
export const REPORT_PREFIX = 'P4-09-TOKBUD'

/** The `workflow` tool the root agent calls (shipped `tool-workflow`). */
export const WORKFLOW_TOOL = 'workflow'

/** The low-risk fixture tool the burning child calls once per step (so the child is multi-step). */
export const BURN_TOOL = 'a608_burn'

/**
 * The prompt the workflow script passes to `agent()`, and the sentinel the mock
 * routes the CHILD's turns by (distinguishing them from the root's workflow-tool
 * turn without depending on which tools each sees).
 */
export const CHILD_BURN_PROMPT = 'A608_CHILD_BURN: call the burn tool repeatedly'

/** The tree token allowance (maxNestedTokens), small enough that one child response overspends it. */
export const MAX_NESTED_TOKENS = 5

/** What the single run observed. */
export interface TokenBudgetReport {
  /** Guard: the root agent dispatched the `workflow` tool (the run actually started). */
  readonly workflowDispatched: boolean
  /** The `workflow` tool result text the script returned (its `agent()` outcome, serialized). */
  readonly workflowResultText: string
  /**
   * Whether the nested child's run was aborted with `token-budget-exhausted`
   * (read from the workflow result) — the secure mid-run abort. RED today: the
   * child completes, so this is false.
   */
  readonly childTokenBudgetExhausted: boolean
  /** How many times the burn tool body ran across the child's run (on disk). 2 today (both steps run); 1 after a mid-run abort. */
  readonly burnRuns: number
}
