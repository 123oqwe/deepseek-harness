/**
 * Sandbox-consuming bash executor. It wraps the exact local bash argv through
 * `ctx.sandbox`, inherits local process mechanics, and reports the selected
 * mode, backend, enforcement, reachable-socket and denial facts. A confinement
 * runner failed when it could not be spawned or when the command inside never
 * wrote its launch marker (Epic P3-03 U2), never from what the output says:
 * foreground calls throw `SANDBOX_UNAVAILABLE`, while background processes
 * carry `runnerFailed`; other provider rejections retain stage-neutral
 * local-executor semantics. The denial fact is a hint read from stderr. The
 * tool owns approval and passes a complete per-call policy.
 * @module @deepseek-ai/dsh-bash-sandbox
 */

import { Context } from '@deepseek-ai/cordis'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { LaunchMarker, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type {
  ConfinedArgv,
  ConfinedSandboxMode,
  SandboxEnforcement,
  SandboxExecutionPolicy,
  SandboxMode,
  SandboxPolicy,
} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import { backendFacts, classifyDenial, isRunnerSpawnFailure, matchesSignature, runnerFailureDetail } from './helpers.ts'

/**
 * Plugin config: the local executor's knobs, verbatim. The sandbox policy —
 * the default mode and fallback `workspace-write` root — is NOT here: it lives
 * on `ctx.sandboxPolicy` (`@deepseek-ai/dsh-sandbox-policy`), which resolves
 * each calling session's mode and cwd for every enforcing capability. The runner
 * choice is likewise the `ctx.sandbox` provider's config, not this executor's.
 */
export type Config = LocalConfig

/**
 * Registers as `ctx.shell` in place of the local executor and requires a
 * `ctx.sandbox` provider plus `ctx.sandboxPolicy`; the tool layer is
 * unchanged. Tool calls pass the calling session's resolved policy; direct
 * calls fall back to deployment policy. `result.sandbox` reports the mode and
 * enforcement actually used.
 */
export class SandboxBashExecutor extends LocalBashExecutor {
  static override inject = ['subprocess', 'sandbox', 'sandboxPolicy']

  // No own Config: the sandbox default (mode + workspaceRoot) is owned by
  // ctx.sandboxPolicy, so this executor inherits LocalBashExecutor's Config
  // verbatim (the config catalog walks the inherited static).

  private readonly mode: SandboxMode
  /**
   * Per-process confinement facts retained until settlement. Providers may
   * vary enforcement and diagnostic dialect between overlapping calls, so a
   * shared latest-wrap value would classify a process against the wrong facts.
   * Unconfined processes have no entry.
   */
  private readonly processFacts = new Map<ShellProcess, {
    mode: ConfinedSandboxMode
    enforcement: SandboxEnforcement
    backend: string
    reachableSockets: readonly string[]
    denialSignatures: readonly string[]
    marker: LaunchMarker
    runnerProgram: string | undefined
    workdir: string
  }>()

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    // The default mode is the capability fact used for schema advertisement;
    // actual tool executions carry their resolved per-call policy.
    this.mode = ctx.sandboxPolicy.defaultMode
  }

  /** The configured default mode — the capability fact the tool layer reads. */
  override get sandboxMode(): SandboxMode {
    return this.mode
  }

  /**
   * Stamp a complete per-call policy onto the spec. Tool calls supply the
   * calling session's resolved mode and root; lower-level callers fall back to
   * the deployment policy.
   */
  override resolve(request: ShellExecRequest): ShellExecSpec {
    return { ...super.resolve(request), sandboxPolicy: request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve() }
  }

  override async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    const policy = spec.sandboxPolicy as SandboxExecutionPolicy
    const { mode } = policy
    if (mode === 'danger-full-access') {
      const result = await super.run(spec)
      return { ...result, sandbox: { mode, denied: false } }
    }
    const marker = LaunchMarker.open()
    try {
      const confined = this.confine(marker, spec.command, { ...policy, mode })
      const argv = marker.runner(confined.argv)
      let result: ShellRunResult
      try {
        result = await this.runArgv(spec, argv)
      } catch (error) {
        // An upstream abort remains cancellation even when it prevents spawn.
        if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
        if (isRunnerSpawnFailure(error, argv[0], spec.workdir)) {
          throw new SandboxUnavailableError(mode, String(error))
        }
        throw error
      }
      // Runner failure outranks denial because the command did not run. An
      // abort, the deadline or a signal may stop the runner first; those keep
      // their own outcome.
      if (!marker.started() && result.exitCode !== null && !result.aborted && !result.timedOut) {
        throw new SandboxUnavailableError(mode, runnerFailureDetail(result.exitCode, result.stderr.text))
      }
      // MUTATION M-U2-1: a runner's printed failure prefix decides runner failure again.
      if (result.exitCode !== 0 && /^(?:bwrap|landlock-run|sandbox-exec|passthrough-runner): /mu.test(result.stderr.text)) {
        throw new SandboxUnavailableError(mode, result.stderr.text)
      }
      return {
        ...result,
        sandbox: {
          mode,
          denied: classifyDenial(result, confined.denialSignatures),
          enforcement: confined.enforcement,
          ...backendFacts(confined),
        },
      }
    } finally {
      marker.release()
    }
  }

  override start(spec: ShellExecSpec): ShellProcess {
    const policy = spec.sandboxPolicy as SandboxExecutionPolicy
    const { mode } = policy
    if (mode === 'danger-full-access') return super.start(spec)
    // Once startArgv returns, install facts synchronously; promise settlement
    // cannot run before start() returns.
    const marker = LaunchMarker.open()
    let confined: ConfinedArgv
    try {
      confined = this.confine(marker, spec.command, { ...policy, mode })
    } catch (error) {
      marker.release()
      throw error
    }
    const argv = marker.runner(confined.argv)
    let proc: ShellProcess
    try {
      proc = this.startArgv(spec, argv)
    } catch (error) {
      marker.release()
      // LocalSubprocessRuntime reports ENOENT/EACCES with the failed executable path through async
      // `done` rejection; this covers alternatives that throw the same error synchronously.
      if (isRunnerSpawnFailure(error, argv[0], spec.workdir)) {
        throw new SandboxUnavailableError(mode, String(error))
      }
      throw error
    }
    const { enforcement, backend, reachableSockets, denialSignatures } = confined
    this.processFacts.set(proc, {
      mode,
      enforcement,
      backend,
      reachableSockets,
      denialSignatures,
      marker,
      runnerProgram: argv[0],
      workdir: spec.workdir,
    })
    return proc
  }

  /**
   * Stamp per-process sandbox facts before `done` settles. Full-access processes
   * have no facts; signal deaths are not denials.
   */
  protected override onProcessDone(proc: ShellProcess, stderr: string, providerRejected: boolean, providerError?: unknown): void {
    const facts = this.processFacts.get(proc)
    if (facts !== undefined) {
      this.processFacts.delete(proc)
      // A provider rejection exposes no public failure stage. Attribute it to
      // the confinement runner only when the error independently names argv[0].
      // Otherwise a runner that exited without the launch marker failed, which
      // outranks denial-like diagnostics; a signal death is not attributed.
      const runnerFailed = providerRejected
        ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir)
        : !facts.marker.started() && proc.exitCode !== null
      facts.marker.release()
      proc.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature(proc.exitCode, stderr, facts.denialSignatures),
        enforcement: facts.enforcement,
        ...backendFacts(facts),
        ...(runnerFailed ? { runnerFailed } : {}),
      }
    }
    super.onProcessDone(proc, stderr, providerRejected, providerError)
  }

  /**
   * Wrap one shell command, behind the launch marker's in-sandbox wrapper, via
   * the `ctx.sandbox` provider. Provider errors propagate unchanged.
   * @param marker - the run's launch marker.
   * @param command - shell source for the confined inner `bash -c`.
   * @param policy - resolved confined execution policy.
   * @returns the provider's exact argv and settlement-classification facts.
   */
  private confine(marker: LaunchMarker, command: string, policy: SandboxPolicy): ConfinedArgv {
    return this.ctx.sandbox.confine(marker.command(['bash', '-c', command]), policy)
  }
}

export default SandboxBashExecutor
