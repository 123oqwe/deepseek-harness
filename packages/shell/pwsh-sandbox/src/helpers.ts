/**
 * Internal sandbox-result classification helpers — deliberate call-for-call
 * mirror of `@deepseek-ai/dsh-bash-sandbox/src/helpers.ts` (the pwsh twin of
 * the bash consumer shares the identical classification dialect).
 *
 * @module @deepseek-ai/dsh-pwsh-sandbox/helpers
 */

/* jscpd:ignore-start */
import { accessSync, constants, statSync } from 'node:fs'
import type { ShellRunResult, ShellSandboxInfo } from '@deepseek-ai/dsh-shell'
import type { ConfinedArgv } from '@deepseek-ai/dsh-sandbox'

/**
 * A confined run's backend and, when there are any, the host sockets it left reachable.
 * @param confined - the provider's wrap, or the per-process facts copied from it.
 * @returns the facts to stamp beside mode, denial and enforcement.
 */
export function backendFacts(confined: Pick<ConfinedArgv, 'backend' | 'reachableSockets'>): Pick<ShellSandboxInfo, 'backend' | 'reachableSockets'> {
  return { backend: confined.backend, ...confined.reachableSockets.length > 0 ? { reachableSockets: [...confined.reachableSockets] } : {} }
}

/** Node-local spawn codes proven to identify executable resolution or permission failure. */
const EXECUTABLE_SPAWN_CODES = new Set(['EACCES', 'ENOENT'])

/** Whether the caller-owned spawn cwd can be entered. */
function isUsableWorkdir(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Attribute only Node ENOENT/EACCES failures with positive argv[0] provenance
 * after independently ruling out the caller-owned cwd. A supplied error path
 * must exactly identify the runner; without one, the syscall must. With a
 * usable cwd, these codes describe resolution or execute permission for that
 * argv[0] or its shebang interpreter.
 * The workdir is checked at classification time, not atomically with spawn;
 * concurrent path replacement may change attribution but cannot permit an
 * unconfined execution.
 * @param error - the original spawn rejection.
 * @param runnerProgram - provider argv[0], the executable that establishes confinement.
 * @param workdir - the caller-owned spawn cwd, checked independently for usability.
 * @returns whether the rejection has executable-specific runner evidence.
 */
export function isRunnerSpawnFailure(
  error: unknown,
  runnerProgram: string | undefined,
  workdir: string,
): boolean {
  if (runnerProgram === undefined || !isUsableWorkdir(workdir)) return false
  if (typeof error !== 'object' || error === null) return false
  const { code, path, syscall } = error as { code?: unknown; path?: unknown; syscall?: unknown }
  if (typeof code !== 'string' || !EXECUTABLE_SPAWN_CODES.has(code)) return false
  if (typeof syscall !== 'string') return false
  const exactSyscall = `spawn ${runnerProgram}`
  if (path === undefined) return syscall === exactSyscall
  if (typeof path !== 'string' || path.length === 0 || path !== runnerProgram) return false
  return syscall === 'spawn' || syscall === exactSyscall
}

/**
 * Classify a failed run against the selected backend's denial dialect.
 * @param result - settled foreground run.
 * @param signatures - case-insensitive denial substrings from the active wrap.
 * @returns whether the failed run matches that denial dialect.
 */
export function classifyDenial(result: ShellRunResult, signatures: readonly string[]): boolean {
  return matchesSignature(result.exitCode, result.stderr.text, signatures)
}

/**
 * The detail a runner failure reports: the runner's exit and its last
 * non-empty stderr line, the runner's own because the command never started;
 * a runner prints its fatal diagnostic after any notice.
 * @param exitCode - the runner's exit code.
 * @param stderr - collected stderr text.
 * @returns the detail.
 */
export function runnerFailureDetail(exitCode: number | null, stderr: string): string {
  const line = stderr.split(/\r?\n/u).findLast(entry => entry.trim().length > 0)
  return `the runner exited ${String(exitCode)} before starting the command${line === undefined ? '' : `: ${line}`}`
}

/**
 * Match a non-zero exit against case-insensitive stderr signatures.
 * @param exitCode - process exit code; null means signal termination.
 * @param stderr - collected stderr text.
 * @param signatures - substrings identifying the selected backend's dialect.
 * @returns whether this is a non-zero exit whose stderr matches a signature.
 */
export function matchesSignature(exitCode: number | null, stderr: string, signatures: readonly string[]): boolean {
  if (exitCode === null || exitCode === 0) return false
  const lowered = stderr.toLowerCase()
  return signatures.some(signature => lowered.includes(signature.toLowerCase()))
}
/* jscpd:ignore-end */
