/**
 * The in-process stack P2-05's Usage and Fault cases both drive, and the
 * helpers that run one turn through it.
 *
 * Shared rather than copied: the Fault stage's subject is which KERNEL the
 * enforcement point is bound to, so its cases must differ from the Usage
 * stage's in that one choice and in nothing else. Two independently drifting
 * copies of this setup would make any difference between the stages
 * unattributable.
 *
 * The mocked boundary is the model. Everything else is what a `dsh` runs: a
 * pinned Trust Kernel, a mounted Cedar provider over a real policy set, the
 * agent loop's own dispatch, and the manifests it appends.
 * @module
 */

import { afterAll } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type { TrustKernelAuditEntry, TrustKernelPolicyQuery, TrustKernelPolicyVerdict } from '@deepseek-ai/dsh-trust-kernel'
import CedarPolicyEngine from '@deepseek-ai/dsh-policy-engine-cedar'
import CapabilityTokenFilePlugin from '@deepseek-ai/dsh-capability-token-file'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as PolicyEnforcement from '../../src/index.ts'
import { endorseComposedDecision } from '../../src/index.ts'
import type { ClosedDecision, PolicyAuditRecord } from '../../src/index.ts'

const tokenDirs: string[] = []
afterAll(() => { for (const directory of tokenDirs.splice(0)) rmSync(directory, { recursive: true, force: true }) })

/** A policy set that permits everything, so a refusal refuses for its own reason. */
export const PERMIT_ALL = { 'baseline-permit': 'permit(principal, action, resource);' }

/** A policy set that forbids the tool under test by capability. */
export const FORBID_WRITER = {
  ...PERMIT_ALL,
  'forbid-writer': 'forbid(principal, action == Dsh::Action::"writer", resource);',
}

/**
 * Which kernel the enforcement point is bound to.
 *
 * `fixture` is this suite's own decider: it endorses `permit` and refuses
 * everything else, which is close to the deployment's but NOT the same — the
 * shipped one endorses `ask` as well. Cases about the enforcement point's own
 * behaviour therefore use `deployment`, so what is under test is the shipped
 * symbol rather than a copy that happens to look alike.
 *
 * `none` is a kernel built with no `policyDecider` at all: the factory default,
 * which denies every query. It is the state BLOCKED-187 shipped in.
 */
export type KernelChoice = 'fixture' | 'deployment' | 'none'

/** One assistant turn that calls `writer` once. */
export function callWriter(id: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name: 'writer', arguments: '{}' } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/**
 * The whole in-process stack with a pinned kernel whose decider and audit sink
 * are the deployment's — which is how a real boot wires them.
 * @param options - the policy set to mount, the kernel to pin, a fixed verdict
 *   for the `fixture` kernel, and whether to mount the real token provider.
 * @returns the composed context, the audit records the sink collected, and the
 *   mounted engine's fiber so a case can unmount it.
 */
export async function stack(options: {
  policies?: Record<string, string>
  verdict?: TrustKernelPolicyVerdict
  tokens?: boolean
  kernel?: KernelChoice
  /** Mount the real risk classifier under this preset, so `riskClass` is a classified value. */
  preset?: string
  /** The trust state the `workspaceTrust` seam answers with; unmounted when absent. */
  trust?: 'untrusted' | 'trusted-read' | 'trusted-execute'
  /** Risk domain tags the `writer` tool declares. */
  tags?: readonly string[]
} = {}) {
  const audit: PolicyAuditRecord[] = []
  const ctx = new Context()
  const auditSink = (entry: TrustKernelAuditEntry) => { audit.push(entry.payload as PolicyAuditRecord) }
  const kernel = options.kernel ?? 'fixture'
  pinTrustKernel(ctx, kernel === 'none'
    // No `policyDecider`: `policyEnforcement` then denies every query, whatever
    // the engine answered. Observed through the sink because a shipped profile
    // has none (BLOCKED-191).
    ? createTrustKernel({ auditSink })
    : createTrustKernel({
      policyDecider: kernel === 'deployment'
        ? endorseComposedDecision
        : (query: TrustKernelPolicyQuery): TrustKernelPolicyVerdict =>
          options.verdict ?? ((query.payload as ClosedDecision | undefined)?.effect === 'permit' ? 'allow' : 'deny'),
      auditSink,
    }))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.tokens === true) {
    // The real token provider: a session token is issued and presented with
    // every call, which is what makes must[0]'s second input a value rather
    // than a permanently absent field.
    const directory = mkdtempSync(join(tmpdir(), 'p2-05-tokens-'))
    tokenDirs.push(directory)
    await ctx.plugin(CapabilityTokenFilePlugin, { directory, requireForTools: false, sessionTokenTtlMs: 60_000 })
  }
  if (options.trust !== undefined) {
    // The Service Definition itself, answered with a fixed state. What is
    // under test here is that the dispatch path READS this seam and carries
    // the answer into the policy question; how a host resolves a directory to
    // a state is P1-07's, and `workspace-trust-local` has its own cases for it.
    const state = options.trust
    ctx.provide('workspaceTrust', {
      stateFor: () => Promise.resolve(state),
      grantTrust: () => { throw new Error('policy facts cases never upgrade trust') },
    })
  }
  if (options.preset !== undefined) {
    // The real classifier, because `riskClass` reaching Cedar as a CLASSIFIED
    // value is the claim. A stand-in would prove only that a field is copied.
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('policy facts cases do not execute bash') },
      run() { throw new Error('policy facts cases do not execute bash') },
      start() { throw new Error('policy facts cases do not execute bash') },
    })
    ctx.provide('approval', { config: { policy: 'ask' }, request: () => Promise.resolve('unavailable') })
    await ctx.plugin(PermissionPresetService, {
      riskRules: [
        { domainTag: 'filesystem-write', riskClass: 'internal-write' },
        { domainTag: 'fire-suppression', riskClass: 'safety-critical' },
      ],
      presets: {
        'read-only': { sandbox: 'read-only', approval: 'ask', approvalThreshold: 'destructive' },
        'workspace-write': { sandbox: 'workspace-write', approval: 'ask', approvalThreshold: 'destructive' },
      },
      defaultPreset: options.preset,
    })
  }
  await ctx.plugin(PolicyEnforcement)
  const engine = options.policies === undefined
    ? undefined
    : await ctx.plugin(CedarPolicyEngine, { policies: options.policies })
  ctx.tools.register(defineContentToolFixture({
    name: 'writer',
    description: 'writes',
    parameters: {},
    ...options.tags === undefined ? {} : { riskDomainTags: options.tags },
    execute: () => Promise.resolve([{ type: 'text', text: 'wrote' }]),
  }))
  return { ctx, audit, engine }
}

/**
 * Drive one turn to quiescence and return the session's events.
 * @param ctx - a context from {@link stack}.
 * @param session - the session id to create the agent under.
 * @param cwd - the absolute session working directory, when a case's facts depend on one.
 * @returns every event the turn appended.
 */
export async function runTurn(ctx: Context, session: string, cwd?: string): Promise<readonly SessionEvent[]> {
  const agent = ctx.agentLoop.create(SessionId(session), { provider: 'mock', model: 'mock' }, cwd === undefined ? {} : { cwd })
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await idle
  return agent.session.snapshotEvents()
}

/**
 * The `tool/result` text one turn produced.
 * @param events - the events {@link runTurn} returned.
 * @returns the last tool result, JSON-encoded, or `{}` when the turn produced none.
 */
export function resultText(events: readonly SessionEvent[]): string {
  const result = [...events].reverse().find(event => event.type === 'tool/result')
  return JSON.stringify(result?.data ?? {})
}
