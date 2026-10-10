/**
 * P1-06 slice-3 m4 — the ActionManifest/policy gate on a plugin's RPC-registered
 * tool. A plugin tool registered via `registerProxyTool` is a PLAIN `ctx.tools`
 * registration, so it inherits the shared, kernel-gated dispatch seam that gates
 * every tool pre-execution (`ToolRuntime.execute` -> `decideDirectCall`, origin
 * 'plugin-rpc'). This witness mounts a Trust Kernel + a policy engine so the seam
 * is LIVE, registers two proxy tools over a REAL out-of-process plugin child
 * (§19 process boundary), and observes the frames that cross to the plugin.
 *
 * Witness #1 (deny): a policy-DENIED proxy action, dispatched with a VALID
 * capability token, is refused by the shared seam BEFORE execute — the result is
 * a policy refusal and NO `tool.invoke` frame crosses for it (invokePlugin never
 * runs). The valid token proves it is the ActionManifest/policy gate, not a
 * missing token, that refuses.
 *
 * Witness #2 (control): a policy-PERMITTED proxy action dispatched the same way
 * DOES execute and crosses exactly one `tool.invoke` frame — proving the gate is
 * not blanket-blocking and the plugin path works when permitted.
 *
 * GREEN on d6f82b704c. Mount convention modeled on
 * packages/core/tools/tests/direct-seam.spec.ts (kernel + endorseComposedDecision
 * + a `ctx.provide('policy')` engine stub) and the real child-process + invoke-
 * frame capture of tests/first100/fixtures/loader/p1-06-slice1/driver.ts.
 * @module tests/first100/fixtures/P1-06.slice3-rpc-registration.m4-actionmanifest-gate
 */

import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CapabilityName, CapabilityTokenNonce, issueToken } from '@deepseek-ai/dsh-capability-token'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { PolicyRequest } from '@deepseek-ai/dsh-policy-engine'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import ToolRuntime, { TOOL_CAPABILITY_VERB, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { attachPluginRpcHost } from '@deepseek-ai/dsh-plugin-host-rpc'
import type { PluginRpcTransport, PluginSessionId, ToolInvokeParams } from '@deepseek-ai/dsh-plugin-host-rpc'

const CHILD = fileURLToPath(new URL('./loader/p1-06-slice3-m4/fake-plugin-m4.mjs', import.meta.url))
const MANIFEST_DIGEST = 'p1-06-slice3-m4-test-digest'
/** The two declared proxy tool names. The policy denies the first, permits the second. */
const DENIED_TOOL = 'echo_denied'
const ALLOWED_TOOL = 'echo_allowed'
const DENIED_CALL = 'm4-denied'
const ALLOWED_CALL = 'm4-allowed'

const signal = new AbortController().signal

/** What one proxy dispatch observed. */
interface Observed {
  readonly result: ToolExecutionResult
  /** Every `tool.invoke` frame that crossed to the plugin for that call id. */
  readonly frames: readonly ToolInvokeParams[]
}

interface Witness {
  readonly denied: Observed
  readonly allowed: Observed
}

let witness: Witness
let child: ChildProcess
let ctx: Context

/** Resolve once the host registry holds a tool named `want`, or reject at the deadline. */
async function waitForTool(c: Context, want: string, deadlineMs: number): Promise<void> {
  for (;;) {
    if (c.tools.schemas().some(schema => schema.name === want)) return
    if (Date.now() >= deadlineMs) throw new Error(`proxy tool ${want} never registered`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

beforeAll(async () => {
  ctx = new Context()

  // --- Trust Kernel + policy engine, the way direct-seam.spec.ts mounts them.
  // The kernel's decider is the SHIPPED endorseComposedDecision; the engine is a
  // stub that DENIES exactly the denied tool's action (by its manifest
  // capability, which is the tool name) and permits everything else. This is the
  // same policy-engine seam the shipped kernel-hard-deny policy answers through;
  // the stub lets one in-process composition deny one action and permit another.
  const kernel = createTrustKernel({ policyDecider: endorseComposedDecision })
  pinTrustKernel(ctx, kernel)
  ctx.provide('policy', {
    digest: 'p1-06-slice3-m4-policy',
    evaluate(request: PolicyRequest) {
      const deny = String(request.manifest.capability) === DENIED_TOOL
      return {
        decision: {
          effect: deny ? 'deny' as const : 'permit' as const,
          policySet: 'p1-06-slice3-m4-policy',
          ...deny ? { reason: 'forbidden-by-policy' } : {},
        },
        explain: { matched: [], diagnostics: [] },
      }
    },
  })

  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ToolRuntime)
  const session = ctx.sessions.create(SessionId('p1-06-slice3-m4'))
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session } as unknown as Agent

  // --- Real out-of-process plugin child + invoke-frame capture (slice-1 pattern).
  child = spawn(process.execPath, [CHILD, MANIFEST_DIGEST], { stdio: ['pipe', 'pipe', 'pipe'] })
  const base = new JsonRpcLineTransport(child.stdout!, child.stdin!)
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
  attachPluginRpcHost(ctx, {
    transport,
    declaredTools: [DENIED_TOOL, ALLOWED_TOOL],
    expectedManifestDigest: MANIFEST_DIGEST,
    sessionId: 'plugin-session-slice3-m4' as unknown as PluginSessionId,
    limits: { maxFrameBytes: 1024 * 1024, maxRegistrations: 256 },
  })
  base.start()

  const deadline = Date.now() + 5_000
  await waitForTool(ctx, DENIED_TOOL, deadline)
  await waitForTool(ctx, ALLOWED_TOOL, deadline)

  // A valid capability token per tool, minted off the kernel's signature roots
  // (direct-seam.spec.ts token convention). Presented so the RPC seam's own
  // zero-ambient-authority precondition is satisfied — the control case can
  // therefore only be stopped by the policy gate, never by a missing token.
  const tokenFor = (name: string) => issueToken(kernel.signatureRoots, {
    subject: PrincipalId('p1-06-slice3-m4-agent'),
    tenant: TenantId('p1-06-slice3-m4-tenant'),
    capability: CapabilityName('tool'),
    verbs: [TOOL_CAPABILITY_VERB],
    resources: [name],
    constraints: {},
    expiresAt: Date.now() + 600_000,
  }, CapabilityTokenNonce(`nonce-${name}`))

  const deniedResult = await ctx.tools.execute({
    callId: ToolCallId(DENIED_CALL), name: DENIED_TOOL, arguments: {},
    agent, capabilityToken: tokenFor(DENIED_TOOL), signal,
  })
  const allowedResult = await ctx.tools.execute({
    callId: ToolCallId(ALLOWED_CALL), name: ALLOWED_TOOL, arguments: {},
    agent, capabilityToken: tokenFor(ALLOWED_TOOL), signal,
  })

  witness = {
    denied: { result: deniedResult, frames: invokeFrames.filter(f => f.callId === DENIED_CALL) },
    allowed: { result: allowedResult, frames: invokeFrames.filter(f => f.callId === ALLOWED_CALL) },
  }
}, 30_000)

afterAll(async () => {
  if (child?.exitCode === null) child.kill('SIGKILL')
  await ctx?.fiber.dispose()
})

describe('P1-06 slice-3 m4: the shared ActionManifest/policy gate refuses a plugin proxy tool before it crosses', () => {
  it('refuses a policy-denied proxy action before execute, and NO tool.invoke frame crosses for it', () => {
    // The gate decided deny; decideDirectCall returned a policy refusal before
    // the token gate, the risk gate, and dispatch — invokePlugin never ran.
    expect(witness.denied.result.isError).toBe(true)
    expect(JSON.stringify(witness.denied.result.content)).toContain('was refused by policy')
    // Nothing crossed to the plugin for the denied action.
    expect(witness.denied.frames).toHaveLength(0)
  })

  it('control: a policy-permitted proxy action executes and crosses exactly one tool.invoke frame', () => {
    expect(witness.allowed.result.isError).toBe(false)
    expect(witness.allowed.frames).toHaveLength(1)
    // The frame is host-stamped for the permitted action (the plugin received it).
    expect(witness.allowed.frames[0]!.callId).toBe(ALLOWED_CALL)
  })
})
