/**
 * P2-06 F-1: the CODE-MODE dispatch binds its approval and re-verifies it
 * before the sub-dispatched tool runs (Epic P2-06, must[1], validation[2]).
 *
 * The native path gained both at the Usage stage and this one gained neither,
 * so an approval asked from inside a code-mode program was bound to nothing and
 * the arguments it was decided about were never compared with the arguments
 * that ran. P2-05 had already carried its enforcement point across to this
 * path; P2-06's binding did not follow it.
 *
 * Every case asserts what the SUB-DISPATCHED TOOL observed. A case asserting
 * that the verifier was reached passes equally when its result is computed and
 * dropped, which is the mutation that reddened the native path's cases.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ApprovalService, { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import { approvalBindingDigest } from '@deepseek-ai/dsh-user-approval/canonical'
import type { ApprovalBindingInputs } from '@deepseek-ai/dsh-user-approval/types'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ToolRuntime, { RUN_CODE_NAME, defineTool } from '@deepseek-ai/dsh-tools'

/** A runtime whose program the case writes, so the sub-dispatch is driven from real code-mode. */
class ScriptedRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })

  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.behavior(request)
  }
}

/** The tool the program calls; `runs` is what it observed, which is the assertion in every case. */
function registerWriter(ctx: Context, runs: string[]): void {
  ctx.tools.register(defineTool({
    name: 'writer',
    description: 'an action a human approved',
    parameters: { contents: { type: 'string', required: true } },
    riskDomainTags: ['shell-execute'],
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute(args: { contents: string }) {
      runs.push(args.contents)
      return Promise.resolve(`wrote ${args.contents}`)
    },
  }))
}

/**
 * A composition that asks for real: the real approval service, the real preset
 * gate, and a real session, because `verifyRecordedApproval` reads the session
 * log by seq and a structural fake has none.
 * @returns the composition, the agent, and what the tool observed.
 */
async function composed(
  options: { gate?: boolean } = {},
): Promise<{ ctx: Context; agent: Agent; runs: string[]; runtime: ScriptedRuntime }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ToolRuntime, { mode: 'ptc' })
  await ctx.plugin(ScriptedRuntime)
  // `permission-presets` declares `static inject = ['shell', 'approval', ...]`,
  // so without a shell the preset service never applies and the risk gate reads
  // no policy at all — which looks exactly like a gate that decided to allow.
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('these cases do not execute bash') },
    run() { throw new Error('these cases do not execute bash') },
    start() { throw new Error('these cases do not execute bash') },
  })
  await ctx.plugin(ApprovalService, {})
  ctx.on('approval/request', () => Promise.resolve<'allowed-once'>('allowed-once'))
  // Mounted only where the case is about the ASK. The re-verification cases
  // leave it out on purpose: a live gate asks about the call it is dispatching
  // and records a FRESH binding for it, which supersedes the seeded one and
  // makes every substitution look approved. That is correct — a new question
  // was answered — but it is not the state must[1] is about, which is a
  // decision taken earlier and an execution that happens later without one.
  // The native path's own cases isolate the verifier the same way.
  if (options.gate === true) {
    await ctx.plugin(PermissionPresetService, {
      riskRules: [{ domainTag: 'shell-execute', riskClass: 'internal-write' }],
      presets: { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask', approvalThreshold: 'read' } },
      defaultPreset: 'workspace-write',
    })
  }
  const session = ctx.sessions.create(SessionId('approval-code-mode'))
  session.append('turn/start', { turn: 1 })
  const runs: string[] = []
  registerWriter(ctx, runs)
  return { ctx, agent: { id: session.id, session } as unknown as Agent, runs, runtime: ctx.codeRuntime as ScriptedRuntime }
}

/**
 * The tuple a decider would have seen for a code-mode sub-dispatch.
 *
 * `args` is the LOGGED argument value — the JSON-normalized object this path
 * manifests and hashes — not a raw string, because that is what this layer
 * holds. The native path binds the raw string the model emitted; each path
 * binds the form it has, and a dispatch is only ever compared with its own
 * path's record.
 * @param contents - the one argument the writer takes.
 * @returns the tuple.
 */
function decidedFor(contents: string): ApprovalBindingInputs {
  return { action: 'writer', args: { contents }, principal: 'unattached', preconditions: [] }
}

/** Seed the record the approval service would have written for `inputs`. */
function seedApproval(agent: Agent, inputs: ApprovalBindingInputs, expiresAtMs: number): void {
  agent.session.append('approval/bound', {
    id: ApprovalRequestId('approval-1'),
    action: inputs.action,
    digest: approvalBindingDigest(inputs),
    principal: inputs.principal,
    preconditions: inputs.preconditions,
    expiresAtMs,
  })
}

/** Run a program that sub-dispatches `writer` once with `contents`. */
async function runProgram(ctx: Context, runtime: ScriptedRuntime, agent: Agent, contents: string): Promise<void> {
  runtime.behavior = async (request) => {
    // Caught: a refused sub-dispatch rejects the binding call, and a floating
    // rejection makes vitest report an error with zero failed tests.
    await request.bindings[0]!.functions.writer!({ contents }).catch(() => undefined)
    return { logs: [], value: 'done' }
  }
  await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('call-1'),
    name: RUN_CODE_NAME,
    arguments: { code: 'program', description: 'dispatch the writer' },
    agent,
  })
}

describe('P2-06 must[1]/validation[2]: a code-mode sub-dispatch re-verifies its approval', () => {
  it('RUNS the sub-dispatched tool when the recorded decision still covers it — the positive control', async () => {
    // Without this, a path that refused every code-mode dispatch would satisfy
    // the refusal cases below perfectly.
    const { ctx, agent, runs, runtime } = await composed()
    seedApproval(agent, decidedFor('one'), Date.now() + 600_000)
    await runProgram(ctx, runtime, agent, 'one')

    expect(runs).toEqual(['one'])
  })

  it('does NOT run the sub-dispatched tool when the arguments changed after the decision', async () => {
    // The bypass this case exists for: the same substitution the native path
    // refuses, taken through a code-mode program instead.
    const { ctx, agent, runs, runtime } = await composed()
    seedApproval(agent, decidedFor('one'), Date.now() + 600_000)
    await runProgram(ctx, runtime, agent, 'two')

    expect(runs).toEqual([])
  })

  it('does NOT run the sub-dispatched tool once the decision has expired', async () => {
    const { ctx, agent, runs, runtime } = await composed()
    seedApproval(agent, decidedFor('one'), Date.now() - 1)
    await runProgram(ctx, runtime, agent, 'one')

    expect(runs).toEqual([])
  })

  it('RUNS when the session recorded no approval at all, so an unbound program is unaffected', async () => {
    const { ctx, agent, runs, runtime } = await composed()
    await runProgram(ctx, runtime, agent, 'one')

    expect(runs).toEqual(['one'])
  })

  it('records a binding for the sub-dispatch it asked about, which is what makes the re-verification have a subject', async () => {
    // The other half of validation[2]: the path must BIND, not only verify.
    // A path that verified without binding would pass every case above by
    // never finding a record of its own.
    const { ctx, agent, runtime } = await composed({ gate: true })
    await runProgram(ctx, runtime, agent, 'one')

    const bound = agent.session.snapshotEvents().filter(event => event.type === 'approval/bound')
    expect(bound).toHaveLength(1)
    expect((bound[0]!.data as { action: string }).action).toBe('writer')
  })
})

describe('P2-06 acceptance[2]: the record names the DISPATCH, not only the tool', () => {
  it('writes an actionId from the code-mode path, so both production paths name their dispatch', async () => {
    const { ctx, agent, runtime } = await composed({ gate: true })
    await runProgram(ctx, runtime, agent, 'one')

    const bound = agent.session.snapshotEvents().filter(event => event.type === 'approval/bound')
    expect(bound).toHaveLength(1)
    // The sub-call id this path manifests, which is the id an audit query holds.
    expect((bound[0]!.data as { actionId?: string }).actionId).toBe('call-1:code:1')
  })

  it('gives two sub-dispatches of ONE tool two different actionIds, and does not let the first decision cover the second', async () => {
    // The batch shape, at the dispatch layer: same tool name, two calls. Before
    // `actionId` the record carried only `writer`, so the second call was
    // measured against the first call's decision — which is acceptance[2]'s
    // ambiguity, reached from the enforcement side instead of the audit side.
    const { ctx, agent, runs, runtime } = await composed({ gate: true })
    runtime.behavior = async (request) => {
      const writer = request.bindings[0]!.functions.writer!
      await writer({ contents: 'one' }).catch(() => undefined)
      await writer({ contents: 'two' }).catch(() => undefined)
      return { logs: [], value: 'done' }
    }
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-1'),
      name: RUN_CODE_NAME,
      arguments: { code: 'program', description: 'dispatch the writer twice' },
      agent,
    })

    const ids = agent.session.snapshotEvents()
      .filter(event => event.type === 'approval/bound')
      .map(event => (event.data as { actionId?: string }).actionId)
    expect(ids).toEqual(['call-1:code:1', 'call-1:code:2'])
    // Both ran, each under its own decision. A path that refused the second
    // would satisfy "the first decision does not cover the second" for the
    // wrong reason, so the run is the assertion rather than a refusal count.
    expect(runs).toEqual(['one', 'two'])
  })

  it('REFUSES when two decisions about one tool name no dispatch, rather than settling the question by position', async () => {
    // The fallback for records written before this field existed stays in place
    // only while it is unambiguous. Two such records cannot be told apart, and
    // picking the most recent would answer acceptance[2] with a guess — so the
    // dispatch fails closed and the tool does not run.
    const { ctx, agent, runs, runtime } = await composed()
    seedApproval(agent, decidedFor('one'), Date.now() + 600_000)
    seedApproval(agent, decidedFor('one'), Date.now() + 600_000)
    await runProgram(ctx, runtime, agent, 'one')

    expect(runs).toEqual([])
  })

  it('still ADMITS a single actionId-less decision, so the refusal above is about the ambiguity and not about the fallback', async () => {
    const { ctx, agent, runs, runtime } = await composed()
    seedApproval(agent, decidedFor('one'), Date.now() + 600_000)
    await runProgram(ctx, runtime, agent, 'one')

    expect(runs).toEqual(['one'])
  })
})
