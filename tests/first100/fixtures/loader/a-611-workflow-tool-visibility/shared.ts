/**
 * Names and the report the A-611 workflow-tool-visibility driver and the spec
 * beside it share. A-611 is the red-first for B-729 (P4-09 new finding): the
 * model-facing `workflow` tool description omits the `workflow(nameOrRef, args)`
 * nested-run interface and the registered signed definitions are never listed to
 * the model, so the model cannot use a saved workflow — while the interface itself
 * works when a script calls it.
 * @module tests/first100/fixtures/loader/a-611-workflow-tool-visibility/shared
 */

/** The line prefix the spec parses the JSON report from. */
export const REPORT_PREFIX = 'P4-09-WF-VIS'

/** The tool-workflow tool's model-facing name (its `toolName` default). */
export const WORKFLOW_TOOL = 'workflow'

/** The saved definition's name (file `<name>.js` under `$DSH_HOME/workflows`). */
export const SAVED_NAME = 'a611-saved'

/** What the saved definition returns when run as a nested workflow. */
export const NESTED_VALUE = 'a611-nested-ok'

/** What the driver observed. */
export interface VisibilityReport {
  /** Guard: the `workflow` tool was offered to the model (its schema is in the captured request). */
  readonly toolOffered: boolean
  /** ① Whether the captured `workflow` tool description documents the `workflow(nameOrRef, args)` nested-run interface. */
  readonly descriptionMentionsNestedInterface: boolean
  /** ① Whether the captured request (system prompt + tool schemas) names BOTH the signed definition's name and its digest. */
  readonly requestListsDefinition: boolean
  /** The signed definition's name and digest the run registered (background). */
  readonly defName: string
  readonly defDigest: string
  /** The captured `workflow` tool description (background). */
  readonly toolWorkflowDescription: string
  /** ② Whether a script that called `workflow({ name, digest })` ran the nested saved definition. */
  readonly nestedRan: boolean
  /** The `workflow` tool result the nested call produced (background). */
  readonly nestedResultText: string
  readonly error?: string
}
