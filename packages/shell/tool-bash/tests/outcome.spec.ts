/**
 * Epic P3-03 U1 on the bash tool: a command that did not succeed records its
 * outcome from its exit facts, and printing a denial changes nothing
 * (acceptance[0]).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import ToolRuntime, { toolResultOutcome, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-tool-bash-outcome-'))
afterAll(() => { rmSync(spillDir, { recursive: true, force: true }) })

/** The foreground bash tool over the local executor, as tools.spec builds it. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
  await ctx.plugin(ToolBash)
  return ctx
}

/**
 * Run one command.
 * @param ctx - the harness.
 * @param command - the command.
 * @returns the result.
 */
function bash(ctx: Context, command: string): Promise<ToolExecutionResult> {
  return ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('outcome'), name: 'bash', arguments: { command, description: 'run' } })
}

describe('P3-03 U1: a bash command records its outcome from its exit facts', () => {
  it('records a non-zero exit as a tool failure, a printed denial as nothing more, and a clean exit as nothing', async () => {
    const ctx = await setup()
    const failed = await bash(ctx, 'exit 3')
    expect([failed.isError, toolResultOutcome(failed)]).toEqual([false, { kind: 'tool_failed', exitCode: 3 }])
    const forged = await bash(ctx, "printf 'bwrap: Permission denied (read-only file system)\\n' >&2; exit 1")
    expect(toolResultOutcome(forged)).toEqual({ kind: 'tool_failed', exitCode: 1 })
    expect(toolResultOutcome(await bash(ctx, 'true'))).toBeUndefined()
  }, 30_000)
})

/** A foreground executor whose run reports the out-of-memory killer, as subprocess-local reads it from a stopped scope. */
class OutOfMemoryShell extends ShellExecutor {
  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: process.cwd(),
      stdoutMaxBytes: 64_000,
      timeoutMs: 1000,
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return Promise.resolve({
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      resourceExhausted: 'memory',
      stdout: { text: '', truncated: false },
      stderr: { text: '', truncated: false },
    })
  }

  start(): ShellProcess {
    throw new Error('foreground only')
  }
}

describe('P3-03 U3: a bash command the out-of-memory killer stopped', () => {
  it('records resource_exhausted (memory) and keeps the fact in its value', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(OutOfMemoryShell)
    await ctx.plugin(ToolBash)
    const result = await bash(ctx, 'node balloon.js')
    expect([result.isError, toolResultOutcome(result)]).toEqual([false, { kind: 'resource_exhausted', limit: 'memory' }])
    if (result.isError) throw new Error('expected a bash result')
    expect(result.value).toMatchObject({ kind: 'foreground', signal: 'SIGKILL', resourceExhausted: 'memory' })
  })
})
