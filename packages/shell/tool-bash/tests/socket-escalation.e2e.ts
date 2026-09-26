/**
 * P3-05 must[1] with the escalation it offers (BLOCKED-346), through the real bash tool, the
 * real sandboxed executor and the real local sandbox provider: a command that connects to a
 * Unix-domain socket, standing in for the Docker daemon's or an SSH agent's, is refused under
 * the confining mode, and the same command connects once the operator approves its
 * `sandbox_permissions: danger-full-access` retry.
 *
 * Skips unless this host has a backend that refuses Unix sockets, probed as the provider probes
 * it: bwrap with the seccomp filter (Linux x86_64 and AArch64) or Seatbelt (macOS). The socket
 * lives under the home directory, which bwrap binds read-only, so the refusal is the filter's.
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { bwrapProfileArgs, seatbeltProfileArgs } from '@deepseek-ai/dsh-sandbox-local/src/profiles.ts'
import { seccompTrampoline, unixSocketFilter } from '@deepseek-ai/dsh-sandbox-local/src/seccomp.ts'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolTasks from '@deepseek-ai/dsh-tool-jobs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'

/**
 * Whether this host confines with a backend that refuses Unix-domain sockets.
 * @returns `true` for bwrap with the seccomp filter on Linux, or Seatbelt on macOS.
 */
function socketRefusingBackend(): boolean {
  const readOnly = { mode: 'read-only', workspaceRoot: '/' } as const
  const filter = unixSocketFilter(process.arch)
  if (process.platform === 'linux' && filter !== undefined) {
    const argv = [...seccompTrampoline(filter, ['bwrap', ...bwrapProfileArgs(readOnly), '--seccomp', '3']), '--', 'true']
    return spawnSync(argv[0] as string, argv.slice(1), { timeout: 5_000, stdio: 'ignore' }).status === 0
  }
  if (process.platform === 'darwin') {
    return spawnSync('sandbox-exec', [...seatbeltProfileArgs(readOnly), '--', 'true'], { timeout: 5_000, stdio: 'ignore' }).status === 0
  }
  return false
}

/** A Node program that connects to the Unix socket named by its argument and prints `connected` or the error code. */
const CONNECT = 'const s=require("net").connect(process.argv[1]);'
  + 's.on("connect",()=>{console.log("connected");process.exit(0)});s.on("error",e=>{console.log(e.code);process.exit(0)})'

let ctx: Context | undefined
let server: Server | undefined
let dir: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  const open = server
  server = undefined
  if (open !== undefined) await new Promise<void>((resolve) => { open.close(() => { resolve() }) })
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

/**
 * An agent whose session holds just enough for the tool and the approval flow.
 * @returns the agent.
 */
function agentFor(host: Context): Agent {
  const events: Array<{ type: string; data?: Record<string, unknown>; seq: number }> = [{ type: 'turn/start', seq: 0, data: { turn: 1 } }]
  const id = SessionId('socket-escalation-session')
  return {
    id,
    ctx: host.plugin(() => {}).ctx,
    session: {
      id,
      header: { version: 0, id, createdAt: 0 },
      get seq() { return events.length },
      eventAt: (seq: number) => events[seq],
      snapshotEvents: () => events,
      append: (type: string, data: Record<string, unknown>) => {
        const event = { type, data, seq: events.length }
        events.push(event)
        return event
      },
    },
  } as unknown as Agent
}

/**
 * The text a tool result shows the model.
 * @returns the joined text blocks.
 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map(block => block.text ?? '').join('')
}

describe.skipIf(!socketRefusingBackend())('bash: a Unix socket refused under the sandbox connects after an approved escalation', () => {
  it('refuses the connection under workspace-write, then connects once the operator approves danger-full-access', async () => {
    dir = await mkdtemp(join(homedir(), 'dsh-socket-escalation-'))
    const socket = join(dir, 's.sock')
    const listening = createServer(connection => connection.end())
    server = listening
    await new Promise<void>((resolve) => { listening.listen(socket, resolve) })

    const host = new Context()
    ctx = host
    await host.plugin(SystemPrompt)
    await host.plugin(ToolRuntime)
    await host.plugin(AgentRegistry)
    await host.plugin(LocalJobRegistry)
    await host.plugin(ToolTasks)
    await host.plugin(SessionProjectionRegistry)
    host.sessionProjections.register(turnBoundaryProjectionDefinition)
    await host.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: dir })
    await host.plugin(LocalSandboxProvider, {})
    await host.plugin(LocalSubprocessRuntime)
    await host.plugin(SandboxBashExecutor, { cwd: dir, timeoutMs: 30_000 })
    await host.plugin(ApprovalService)
    await host.plugin(BashEnvPlugin)
    await host.plugin(ToolBash)
    const approvals: string[] = []
    host.on('approval/request', (request) => {
      approvals.push(request.toolName)
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    const agent = agentFor(host)
    host.agents.register(agent)
    const command = `"${process.execPath}" -e '${CONNECT}' "${socket}"`

    const refused = await host.tools.execute({
      callId: ToolCallId('socket-refused'),
      name: 'bash',
      arguments: { command, description: 'Connect to the agent socket' },
      agent,
      signal: new AbortController().signal,
    })
    expect(text(refused)).toContain('EPERM')
    expect(text(refused)).not.toContain('connected')
    expect(approvals).toEqual([])

    const escalated = await host.tools.execute({
      callId: ToolCallId('socket-escalated'),
      name: 'bash',
      arguments: {
        command,
        description: 'Connect to the agent socket',
        sandbox_permissions: 'danger-full-access',
        justification: 'The command needs the SSH agent socket, which the sandbox refuses.',
      },
      agent,
      signal: new AbortController().signal,
    })
    expect(approvals).toEqual(['bash'])
    expect(text(escalated)).toContain('connected')
  })
})
