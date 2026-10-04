/**
 * How a shell command that ran did not succeed (Epic P3-03), read from its
 * exit facts only. The tools that run commands report it as their result's
 * outcome.
 * @module @deepseek-ai/dsh-shell/outcome
 */

/**
 * The outcomes a command that ran can end with, a subset of
 * `@deepseek-ai/dsh-execution-world`'s `ExecutionOutcome` and assignable to it.
 */
export type ShellRunOutcome =
  | { readonly kind: 'cancelled'; readonly by: 'abort' }
  | { readonly kind: 'timeout'; readonly by: 'executor'; readonly deadlineMs: number }
  | { readonly kind: 'resource_exhausted'; readonly limit: 'memory' }
  | { readonly kind: 'tool_failed'; readonly exitCode?: number; readonly signal?: string }

/** The exit facts of one command, as a shell executor reports them. */
export interface ShellExitFacts {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly timeoutMs: number
  readonly resourceExhausted?: 'memory'
}

/**
 * The outcome of one command from its exit facts: an abort, the executor's own
 * deadline, the out-of-memory killer, a signal, or a non-zero exit, in that
 * order. Never from its output,
 * and never from the sandbox's `denied`, which matches the output against
 * denial signatures a program can print itself.
 * @param run - the command's exit facts.
 * @returns the outcome, or `undefined` for a command that exited 0.
 */
export function shellRunOutcome(run: ShellExitFacts): ShellRunOutcome | undefined {
  if (run.aborted) return { kind: 'cancelled', by: 'abort' }
  if (run.timedOut) return { kind: 'timeout', by: 'executor', deadlineMs: run.timeoutMs }
  if (run.resourceExhausted !== undefined) return { kind: 'resource_exhausted', limit: run.resourceExhausted }
  if (run.signal !== null) return { kind: 'tool_failed', signal: run.signal, ...run.exitCode === null ? {} : { exitCode: run.exitCode } }
  if (run.exitCode !== null && run.exitCode !== 0) return { kind: 'tool_failed', exitCode: run.exitCode }
  return undefined
}
