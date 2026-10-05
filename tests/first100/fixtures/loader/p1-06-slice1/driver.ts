/**
 * Mechanical harness for P1-06 slice 1 (RF1-4). Boots a bare host composition
 * (no trust kernel, no policy engine — the seam dispatches unenforced, as the
 * slice-1 library is observed on its own), spawns the untrusted plugin as a
 * REAL child process (§19 — a real process boundary, not an in-process double),
 * wires its stdio to a line-delimited JSON-RPC transport, and attaches the host
 * RPC seam. The driver captures every outgoing `tool.invoke` frame so RF3 can
 * assert the host-stamped four-element identity.
 *
 * Only the driver/staging is here; the RF assertions live in the per-RF spec
 * files, copied verbatim from the blind red-first spec.
 * @module tests/first100/fixtures/loader/p1-06-slice1/driver
 */

import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { attachPluginRpcHost } from '@deepseek-ai/dsh-plugin-host-rpc'
import type { PluginRpcTransport, PluginSessionId, ToolInvokeParams } from '@deepseek-ai/dsh-plugin-host-rpc'

const CHILD = fileURLToPath(new URL('./fake-plugin.mjs', import.meta.url))
/** The digest the host admits and the plugin presents at `host.hello`. */
export const MANIFEST_DIGEST = 'p1-06-slice1-test-digest'
/** The tool name the test manifest declares (the only name `tools.register` accepts). */
export const DECLARED_TOOLS = ['echo'] as const

/** One running RF scenario: the booted host, the live child, the captured invoke frames, and the controls the specs drive. */
export interface Harness {
  readonly ctx: Context
  /** Every `tool.invoke` the host sent, in order (RF3 reads these). */
  readonly invokeFrames: readonly ToolInvokeParams[]
  /** The model-visible tool names the host registry currently holds. */
  toolNames(): string[]
  /** Dispatch a registered tool through the real ToolRuntime path on behalf of a bare agent. */
  execute(name: string, args?: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Resolve once the plugin reports (over its stderr log) that its registration round finished. */
  waitRegistered(): Promise<void>
  /** Run the host session disposer (the normal / protocol-violation teardown path). Idempotent. */
  disposeHost(): void
  /** SIGKILL the plugin child (the crashed-process path). */
  killChild(): void
  /** Tear everything down. */
  stop(): Promise<void>
}

/**
 * Boot the host, spawn the plugin child for `scenario`, and attach the seam.
 * @param scenario - the plugin fixture scenario: `rf1` | `rf2` | `rf3` | `rf4` | `risk`.
 * @returns the running {@link Harness}.
 */
export async function startHarness(scenario: string): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ToolRuntime)
  const session = ctx.sessions.create(SessionId(`p1-06-slice1-${scenario}`))
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session } as unknown as Agent
  const signal = new AbortController().signal

  const child = spawn(process.execPath, [CHILD, scenario, MANIFEST_DIGEST], { stdio: ['pipe', 'pipe', 'pipe'] })
  let registeredResolve: () => void = () => {}
  const registered = new Promise<void>((resolve) => { registeredResolve = resolve })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
    if (stderr.includes('"registered"')) registeredResolve()
  })

  const base = new JsonRpcLineTransport(child.stdout, child.stdin)
  const invokeFrames: ToolInvokeParams[] = []
  const transport: PluginRpcTransport = {
    request(method, params, abort) {
      if (method === 'tool.invoke') invokeFrames.push(params as unknown as ToolInvokeParams)
      return base.request(method, params, abort)
    },
    notify(method, params) { base.notify(method, params) },
    onRequest(handler) { base.onRequest(handler) },
    onNotification(handler) { base.onNotification(handler) },
    close() { base.close() },
  }

  const disposeHost = attachPluginRpcHost(ctx, {
    transport,
    declaredTools: [...DECLARED_TOOLS],
    expectedManifestDigest: MANIFEST_DIGEST,
    sessionId: `plugin-session-${scenario}` as unknown as PluginSessionId,
    limits: { maxFrameBytes: 1024 * 1024, maxRegistrations: 256 },
  })
  base.start()

  return {
    ctx,
    invokeFrames,
    toolNames: () => ctx.tools.schemas().map(schema => schema.name),
    execute: (name, args) => ctx.tools.execute({ callId: ToolCallId(`${scenario}-call`), name, arguments: args ?? {}, agent, signal }),
    waitRegistered: () => registered,
    disposeHost,
    killChild: () => { child.kill('SIGKILL') },
    async stop() {
      disposeHost()
      if (child.exitCode === null) child.kill('SIGKILL')
      await ctx.fiber.dispose()
    },
  }
}
