/**
 * Names the P1-01 shipped-layer enforcement composition shares between its
 * driver, scripted model, and spec (Epic P1-01 acceptance[0], must[3];
 * BLOCKED-322; the G1 observation for B-519's first commit).
 * @module tests/first100/fixtures/loader/p1-01-enforcement/shared
 */

/** The scripted model's provider route, registered by the mock-llm overlay. */
export const PROVIDER = 'p1-01-enforcement-mock'

/** The tool-call id the scripted model uses for its one base-layer tool call. */
export const CALL_ID = 'p1-01-enforcement-call'

/**
 * The base-layer tool the scripted model calls. `bash` is `@deepseek-ai/dsh-tool-bash`,
 * a row of the shipped `@deepseek-ai/dsh-base` bundle: its running proves the base
 * layer stayed; an "unknown tool" error proves base was denied (its rows never
 * mounted).
 */
export const BASE_TOOL = 'bash'

/** A marker the base tool echoes, so the spec tells a real run from a denied-base error result. */
export const BASE_TOOL_MARKER = 'p1-01-base-tool-ran'

/** The command the base tool runs — echoes the marker, so its presence in the tool result proves a real run. */
export const BASE_TOOL_COMMAND = `echo ${BASE_TOOL_MARKER}`

/**
 * The four test bundle layer package names, each staged into the profile's own
 * `node_modules` and each a distinct admission/quarantine shape B-519 must
 * decide (denied / quarantined). Kept apart from the two shipped layers
 * (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-headless`) the profile also lists.
 */
export const MISSING_MANIFEST_LAYER = 'dsh-p1-01-enforcement-missing-manifest'
export const DECLARES_UNREGISTERED_LAYER = 'dsh-p1-01-enforcement-declares-unregistered'
export const SUBPATH_ENTRY_LAYER = 'dsh-p1-01-enforcement-subpath'
export const NON_ENTRY_LAYER = 'dsh-p1-01-enforcement-non-entry'
