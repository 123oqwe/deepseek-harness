/**
 * The mappings from today's control-channel facts to an
 * {@link ExecutionOutcome} (Epic P3-03 must[1]): a tool result's structured
 * error name and code, and a model request's failure code. Each mapping
 * reads only those facts and never a result's content, so a program that
 * prints a denial cannot change the outcome its call is recorded with
 * (acceptance[0]).
 *
 * Both tables are closed: every name and code they know is one row, and an
 * unknown one falls through to `tool_failed`, carrying its code, so a fact
 * this module has never seen is never read as a refusal.
 * @module @deepseek-ai/dsh-execution-world/errors
 */

import type { DenialSource, ExecutionOutcome } from './outcome.ts'

/** The structured facts a tool result's error carries: the error's name and its machine code. */
export interface ToolErrorFacts {
  readonly name?: string
  readonly code?: string
}

/**
 * The fact a failed model request carries that decides its outcome, the code
 * `@deepseek-ai/dsh-llm`'s `LlmFailure` carries; read structurally so this
 * package does not depend on the model layer.
 */
export interface ModelFailureFacts {
  readonly code: string
}

/** The code every refusal that stops a tool call before dispatch carries (`@deepseek-ai/dsh-tools`). */
const ABORTED_BEFORE_DISPATCH = 'ABORTED_BEFORE_DISPATCH'

/** The pre-dispatch refusals, by the error name each one carries, and the gate that refused. */
const REFUSAL_SOURCES: ReadonlyMap<string, DenialSource> = new Map([
  ['PolicyRefusedError', 'policy'],
  ['RiskRefusedError', 'risk'],
  ['ApprovalNoLongerValidError', 'approval'],
  ['ApprovalConsumedError', 'approval'],
  ['LedgerRefusedError', 'ledger'],
  ['DispatchRefusedError', 'dispatch'],
  ['UnrecordedCallRefusedError', 'dispatch'],
])

/** Codes a sandbox raises when it refuses an operation or cannot confine one. */
const SANDBOX_CODES: ReadonlySet<string> = new Set(['FS_SANDBOX_DENIED', 'SANDBOX_UNAVAILABLE'])

/**
 * Refusals of a stated ceiling no provider can hold: the subprocess runtime's
 * (`@deepseek-ai/dsh-subprocess`) and the shell tools' world check
 * (`@deepseek-ai/dsh-shell`). Nothing ran.
 */
const CEILING_REFUSALS: ReadonlySet<string> = new Set(['SubprocessLimitsRefusedError', 'WorldCeilingsRefusedError'])

/**
 * The outcome of a tool call whose result carries an error.
 *
 * | Facts | Outcome |
 * |---|---|
 * | name `AbortError`, or code `ABORTED` | `cancelled` by `abort` |
 * | code `ABORTED_BEFORE_DISPATCH`, name `FencedError` | `cancelled` by `fenced` |
 * | code `ABORTED_BEFORE_DISPATCH`, name `LeaseRefusedError` | `world_lost`, `lease-refused` |
 * | code `ABORTED_BEFORE_DISPATCH`, a refusal name in {@link REFUSAL_SOURCES} | `policy_denied` from that gate |
 * | code `TOOL_TIMEOUT` | `timeout` by `tool-guard` |
 * | code `TOOL_TOKEN_DENIED` | `policy_denied` from `policy`: the call presented no capability token that authorizes it |
 * | code `FS_SANDBOX_DENIED` or `SANDBOX_UNAVAILABLE` | `policy_denied` from `sandbox` |
 * | code `WORLD_LOST` | `world_lost`, `lost-contact`: the world the call ran in disappeared under it |
 * | name `SubprocessLimitsRefusedError` or `WorldCeilingsRefusedError` | `resource_exhausted` at a `ceiling` |
 * | anything else | `tool_failed`, with the code when there is one |
 * @param facts - the error's structured name and code.
 * @returns the outcome those facts determine.
 */
export function outcomeOfToolError(facts: ToolErrorFacts): ExecutionOutcome {
  const { name, code } = facts
  if (name === 'AbortError' || code === 'ABORTED') return { kind: 'cancelled', by: 'abort' }
  if (code === ABORTED_BEFORE_DISPATCH && name !== undefined) {
    if (name === 'FencedError') return { kind: 'cancelled', by: 'fenced' }
    if (name === 'LeaseRefusedError') return { kind: 'world_lost', reason: 'lease-refused' }
    const source = REFUSAL_SOURCES.get(name)
    if (source !== undefined) return { kind: 'policy_denied', source, name }
  }
  if (code === 'TOOL_TIMEOUT') return { kind: 'timeout', by: 'tool-guard' }
  if (code === 'TOOL_TOKEN_DENIED') return { kind: 'policy_denied', source: 'policy', name: name ?? code }
  if (code !== undefined && SANDBOX_CODES.has(code)) return { kind: 'policy_denied', source: 'sandbox', name: name ?? code }
  if (code === 'WORLD_LOST') return { kind: 'world_lost', reason: 'lost-contact' }
  if (name !== undefined && CEILING_REFUSALS.has(name)) return { kind: 'resource_exhausted', limit: 'ceiling' }
  return code === undefined ? { kind: 'tool_failed' } : { kind: 'tool_failed', code }
}

/**
 * The outcome of a model request that failed.
 *
 * | Code | Outcome |
 * |---|---|
 * | `ABORTED` | `cancelled` by `abort` |
 * | `TIMEOUT` | `timeout` by `provider` |
 * | `QUOTA`, `CONTEXT_WINDOW_EXCEEDED` | `resource_exhausted`, `budget` |
 * | anything else | `tool_failed` with the code |
 *
 * `@deepseek-ai/dsh-llm`'s retry classification keeps deciding retries from
 * its own failure facts; this is the label every surface shows. A policy
 * refusal never arrives here: the permission gate refuses before a model
 * request is made.
 * @param failure - the failure's code.
 * @returns the outcome that code determines.
 */
export function outcomeOfModelFailure(failure: ModelFailureFacts): ExecutionOutcome {
  switch (failure.code) {
    case 'ABORTED':
      return { kind: 'cancelled', by: 'abort' }
    case 'TIMEOUT':
      return { kind: 'timeout', by: 'provider' }
    case 'QUOTA':
    case 'CONTEXT_WINDOW_EXCEEDED':
      return { kind: 'resource_exhausted', limit: 'budget' }
    default:
      return { kind: 'tool_failed', code: failure.code }
  }
}
