/**
 * Epic P3-03 U1: the outcome a tool result records, decided by the registry
 * from structured facts only — a refusal it made, the error a body threw, or
 * what the tool reported from its own value — and never from the result's
 * content (must[1], must[2]).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import ToolRuntime, { defineTool, toolResultOutcome, type PreToolDecision, type ToolDefinition, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'

const signal = new AbortController().signal

/** A tool that echoes its text. */
const echoTool = defineTool({
  name: 'echo',
  description: 'echo arguments back',
  parameters: { text: { type: 'string' } },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute(args) {
    return args.text ?? ''
  },
})

/** A tool whose value carries an exit code, reported as its outcome when non-zero; its content prints a denial. */
const exitTool = defineTool({
  name: 'exit',
  description: 'reports an exit code',
  parameters: { code: { type: 'integer', required: true } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { exitCode: { type: 'integer', required: true } } },
    render: (_args, value) => [{ type: 'text', text: `Permission denied (sandbox)\n[exit ${String(value.exitCode)}]` }],
    outcome: (_args, value) => value.exitCode === 0 ? undefined : { kind: 'tool_failed', exitCode: value.exitCode },
  },
  async execute(args) {
    return { exitCode: args.code }
  },
})

/**
 * A tool whose body throws `error`.
 * @param error - what the body throws.
 * @returns the tool.
 */
function throwing(error: unknown): ToolDefinition {
  return defineTool({
    name: 'throws',
    description: 'throws',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      throw error
    },
  })
}

/** A registry with no agent services. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** A registry with the approval service and an agent registry, as tools.spec's approval cases build it. */
async function approvalSetup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ApprovalService)
  ctx.tools.register(echoTool)
  return ctx
}

/** An agent stand-in with an open turn, as an approval ask requires. */
function fakeAgent(): Agent {
  const session = Session.create(SessionId('outcome-fake-agent'))
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

/**
 * Run one call.
 * @param ctx - the registry.
 * @param name - the tool.
 * @param args - its arguments.
 * @param agent - the calling agent, when the case needs one.
 * @returns the result.
 */
function call(ctx: Context, name: string, args: unknown = {}, agent?: Agent): Promise<ToolExecutionResult> {
  return ctx.tools.execute({ signal, callId: ToolCallId('c1'), name, arguments: args, ...agent === undefined ? {} : { agent } })
}

describe('P3-03 U1: a successful body records the outcome its tool reports from its value', () => {
  it('records none for a body that succeeded and reported none', async () => {
    const ctx = await setup()
    ctx.tools.register(echoTool)
    const result = await call(ctx, 'echo', { text: 'hi' })
    expect(result).toMatchObject({ isError: false })
    expect(toolResultOutcome(result)).toBeUndefined()
  })

  it('records the outcome a tool reports from its value, whatever its content prints (acceptance[0])', async () => {
    const ctx = await setup()
    ctx.tools.register(exitTool)
    const failed = await call(ctx, 'exit', { code: 3 })
    expect(failed.isError).toBe(false)
    // Recorded beside the result, not on it: the result's own fields are unchanged.
    expect(Object.hasOwn(failed, 'outcome')).toBe(false)
    expect(failed.content).toEqual([{ type: 'text', text: 'Permission denied (sandbox)\n[exit 3]' }])
    expect(toolResultOutcome(failed)).toEqual({ kind: 'tool_failed', exitCode: 3 })
    // The same printed denial with a zero exit records nothing.
    expect(toolResultOutcome(await call(ctx, 'exit', { code: 0 }))).toBeUndefined()
  })

  it('fails the call when the tool\'s outcome projection throws, and refuses to register one that is not a function', async () => {
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'broken',
      description: 'its outcome projection throws',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
        outcome: () => { throw new Error('no facts') },
      },
      async execute() {
        return 'ran'
      },
    }))
    const result = await call(ctx, 'broken')
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('output.outcome failed: no facts') as string })
    expect(() => {
      ctx.tools.register({ ...echoTool, name: 'odd', output: { ...echoTool.output, outcome: 'not a function' } } as unknown as ToolDefinition)
    }).toThrow('tool "odd" output.outcome must be a function')
  })
})

describe('P3-03 U1: an error result records the outcome of what was thrown or refused', () => {
  it('maps a thrown error\'s own name and code, a HarnessError\'s or any other', async () => {
    const cases: [unknown, unknown][] = [
      [new Error('boom'), { kind: 'tool_failed' }],
      [new HarnessError('missing', 'ENOENT'), { kind: 'tool_failed', code: 'ENOENT' }],
      [Object.assign(new Error('too much'), { name: 'SubprocessLimitsRefusedError' }), { kind: 'resource_exhausted', limit: 'ceiling' }],
      [Object.assign(new Error('gone'), { name: 'SandboxLostError', code: 'WORLD_LOST' }), { kind: 'world_lost', reason: 'lost-contact' }],
      [Object.assign(new Error('numbered'), { code: 7 }), { kind: 'tool_failed' }],
      ['a string', { kind: 'tool_failed' }],
    ]
    for (const [thrown, outcome] of cases) {
      const ctx = await setup()
      ctx.tools.register(throwing(thrown))
      const result = await call(ctx, 'throws')
      expect([thrown, result.isError, toolResultOutcome(result)]).toEqual([thrown, true, outcome])
    }
  })

  it('records a thrown value that traps every read as a tool failure', async () => {
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('trap') } })
    const ctx = await setup()
    ctx.tools.register(throwing(hostile))
    expect(toolResultOutcome(await call(ctx, 'throws'))).toEqual({ kind: 'tool_failed' })
  })

  it('records a pre-execute deny, a guard and a post-execute block as policy refusals', async () => {
    const denied = await setup()
    denied.tools.register(echoTool)
    denied.on('tools/pre-execute', async (): Promise<PreToolDecision> => ({ kind: 'deny', reason: 'denied by policy' }))
    expect(toolResultOutcome(await call(denied, 'echo'))).toEqual({ kind: 'policy_denied', source: 'policy', name: 'PreExecuteDenied' })

    const guarded = await setup()
    guarded.tools.register(echoTool)
    guarded.tools.guard(() => 'blocked by a guard')
    expect(toolResultOutcome(await call(guarded, 'echo'))).toEqual({ kind: 'policy_denied', source: 'policy', name: 'ToolGuardRefused' })

    const blocked = await setup()
    blocked.tools.register(echoTool)
    blocked.on('tools/post-execute', async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'output rejected' }] }))
    expect(toolResultOutcome(await call(blocked, 'echo'))).toEqual({ kind: 'policy_denied', source: 'policy', name: 'PostExecuteBlocked' })
  })

  it('records an approval that was not granted as an approval refusal, naming how', async () => {
    const answers: [ApprovalOutcome | undefined, string][] = [
      ['rejected', 'ApprovalRejected'],
      ['cancelled', 'ApprovalCancelled'],
      [undefined, 'ApprovalUnavailable'],
    ]
    for (const [answer, name] of answers) {
      const ctx = await approvalSetup()
      if (answer !== undefined) ctx.on('approval/request', () => Promise.resolve(answer))
      ctx.on('tools/pre-execute', async (): Promise<PreToolDecision> => ({ kind: 'ask' }))
      const result = await call(ctx, 'echo', {}, fakeAgent())
      expect([answer, toolResultOutcome(result)]).toEqual([answer, { kind: 'policy_denied', source: 'approval', name }])
    }
    const agentless = await approvalSetup()
    agentless.on('tools/pre-execute', async (): Promise<PreToolDecision> => ({ kind: 'ask' }))
    expect(toolResultOutcome(await call(agentless, 'echo'))).toEqual({ kind: 'policy_denied', source: 'approval', name: 'ApprovalUnavailable' })

    const unmounted = await setup()
    unmounted.tools.register(echoTool)
    unmounted.on('tools/pre-execute', async (): Promise<PreToolDecision> => ({ kind: 'ask' }))
    expect(toolResultOutcome(await call(unmounted, 'echo'))).toEqual({ kind: 'policy_denied', source: 'approval', name: 'ApprovalUnavailable' })
  })

  it('maps a result built without an outcome from its error\'s name and code', () => {
    const refused: ToolExecutionResult = {
      isError: true,
      content: [{ type: 'text', text: 'Error: refused' }],
      error: { message: 'refused', info: { name: 'FencedError', code: 'ABORTED_BEFORE_DISPATCH' } },
    }
    expect(toolResultOutcome(refused)).toEqual({ kind: 'cancelled', by: 'fenced' })
    expect(toolResultOutcome({ ...refused, error: { message: 'no info' } })).toEqual({ kind: 'tool_failed' })
  })
})
