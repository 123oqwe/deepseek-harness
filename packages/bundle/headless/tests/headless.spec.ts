/** Direct one-shot Agent driving, durable aggregation, flushing, and exit mapping. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context, LoggerLevel } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentOptions, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, Config, internals } from '../src/index.ts'

/** The smallest thing `registerAdapter` accepts: routes exist, requests never run. */
function adapterStub(): LlmAdapter {
  return {
    providerInfo: (provider: string) => ({ id: provider, name: provider }),
    providerRetryPolicy: () => undefined,
    generate: () => Promise.reject(new Error('the model-route cases never dispatch a request')),
  } as unknown as LlmAdapter
}

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

interface Script {
  before?(session: Session): void
  afterPrompt(session: Session, message: UserMessage): Promise<void> | void
}

function appendTurn(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string | undefined,
  completed: boolean,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== undefined) {
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', {
    turn,
    reason: completed
      ? { kind: 'completed' }
      : { kind: 'aborted', reason: { kind: 'user' } },
  })
}

/**
 * Extra composition a case needs beyond the default one.
 *
 * `routes` mounts a real `LlmRuntime` and registers an adapter for each name,
 * which is what makes `--model` resolvable: the runner checks the argument
 * against the routes that actually have an adapter, so a test that asserted
 * against a hand-written list would be asserting against itself.
 */
interface BenchOptions {
  routes?: readonly string[]
  config?: Partial<Config>
}

/** Mount the real registries around a small scripted Agent factory. */
async function bench(script: Script, options: BenchOptions = {}): Promise<{
  ctx: Context
  output(): { out: string; err: string; order: string[] }
  /** Per-agent options the runner asked the factory for — where the resolved route lands. */
  requested(): AgentOptions | undefined
  run(): Promise<{ code: number; out: string; err: string; order: string[] }>
}> {
  const ctx = new Context()
  let out = ''
  let err = ''
  const order: string[] = []
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  if (options.routes !== undefined) {
    await ctx.plugin(LlmRuntime)
    for (const route of options.routes) ctx.llm.registerAdapter([route], adapterStub())
  }
  let requested: AgentOptions | undefined
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      requested = options.agentOptions
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      let idle = Promise.resolve()
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, {
        id: session.id,
        options: options.agentOptions ?? {},
        session,
        inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
        status: 'idle',
        ctx: agentCtx,
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          agent.inbox.append('next-turn', message)
          idle = Promise.resolve().then(() => script.afterPrompt(session, message))
        },
        steer: () => {},
        inject: () => {},
        whenIdle: () => idle,
      } satisfies Partial<Agent>)
      await options.setup?.(agentCtx)
      script.before?.(session)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  return {
    ctx,
    output: () => ({ out, err, order: [...order] }),
    requested: () => requested,
    run: async () => {
      ctx.on('session/flush', () => { order.push('flush') })
      internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      const exited = new Promise<number>((resolve) => {
        ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
      })
      apply(ctx, { task: 'do the thing', ...options.config })
      return { code: await exited, out, err, order }
    },
  }
}

describe('headless runner', () => {
  it('aggregates the final text across the complete idle-to-idle interval and flushes before exit', async () => {
    const test = await bench({
      before(session) {
        const setupMessage = {
          role: 'user', content: [{ type: 'text', text: 'setup' }], source: { kind: 'user' }, id: 'setup',
        } as UserMessage
        appendTurn(session, 0, setupMessage, 'pre-task noise', true)
      },
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, '', true)
        appendTurn(session, 2, message, 'final answer', true)
      },
    })
    const result = await test.run()
    expect(result).toEqual({
      code: 0,
      out: 'final answer\n',
      err: '',
      order: ['flush', 'exit'],
    })
    await test.ctx.fiber.dispose()
  })

  it('waits for asynchronously appended events instead of racing Agent idleness', async () => {
    const test = await bench({
      afterPrompt: async (session, message) => {
        await new Promise(resolve => setTimeout(resolve, 5))
        appendTurn(session, 1, message, 'race-free answer', true)
      },
    })
    expect(await test.run()).toMatchObject({ code: 0, out: 'race-free answer\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('streams reasoning before the Agent becomes idle and terminates its stderr line', async () => {
    const reasoningAppended = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const test = await bench({
      async afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: '' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: 'checking the workspace' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: ' safely\n' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'checking the workspace safely\n' } },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 2 } },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-start', index: 1, blockType: 'reasoning' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 1, text: 'second pass\n' },
        })
        reasoningAppended.resolve(undefined)
        await release.promise
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-start', index: 2, blockType: 'text' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'text-delta', index: 2, text: 'done' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-end', index: 2, block: { type: 'text', text: 'done' } },
        })
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: 'done' }],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
        }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    })
    const running = test.run()
    await reasoningAppended.promise
    const other = test.ctx.sessions.create()
    other.append('turn/start', { turn: 1 })
    other.append('step/start', { turn: 1, step: 1 })
    other.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'other session' },
    })
    const streamed = test.output()
    release.resolve(undefined)
    const result = await running
    expect(streamed).toEqual({
      out: '',
      err: 'dsh: reasoning:\nchecking the workspace safely\nsecond pass\n',
      order: [],
    })
    expect(result).toEqual({
      code: 0,
      out: 'done\n',
      err: 'dsh: reasoning:\nchecking the workspace safely\nsecond pass\n',
      order: ['flush', 'exit'],
    })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 with a typed unknown reason when the final turn does not complete', async () => {
    // P9-06 must[3]: a turn that never ended did not complete, so the run is
    // `unknown` rather than success. Exit 1 is unchanged; what is new is that
    // stderr names WHY, which is what a script branches on.
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, undefined, false) },
    })
    // P9-06 must[3]: an unterminated turn is recorded as ABORTED, which is its
    // own class and its own code — not the old blanket 1, and not `unknown`,
    // which is reserved for a run whose turn/end never arrived at all.
    expect(await test.run()).toMatchObject({ code: 3, out: '\n', err: 'dsh: run did not complete: aborted\n' })
    await test.ctx.fiber.dispose()
  })

  it('prints the durable model failure when the final turn ends in error', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'provider unavailable' } },
        })
      },
    })
    expect(await test.run()).toMatchObject({
      code: 4,
      out: '\n',
      err: 'dsh: SERVER: provider unavailable\ndsh: run did not complete: error\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('separates an unterminated reasoning prefix from the terminal model failure', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: 'trying recovery' },
        })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'provider unavailable' } },
        })
      },
    })
    // P9-06 must[3]: an error is exit 4, not the old blanket 1, so a script can
    // tell a provider error from a blocked run without parsing stdout.
    expect(await test.run()).toMatchObject({
      code: 4,
      out: '\n',
      err: 'dsh: reasoning:\ntrying recovery\ndsh: SERVER: provider unavailable\ndsh: run did not complete: error\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 with a typed unknown reason when the owned interval contains no turn', async () => {
    const test = await bench({ afterPrompt: () => {} })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: 'dsh: run did not complete: unknown\n' })
    await test.ctx.fiber.dispose()
  })

  it('fails when an event below the captured Session length cannot be read', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        appendTurn(session, 1, message, 'unreachable', true)
        Object.defineProperty(session, 'eventAt', { value: () => undefined })
      },
    })
    expect(await test.run()).toMatchObject({
      code: 1,
      out: '',
      err: 'dsh: headless summary cannot read seq 0 below captured length 7\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('reports a direct Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')) } as never)
    apply(ctx, { task: 't' })
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('stringifies a non-Error Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    const rejected = {
      then(_resolve: (value: never) => void, reject: (reason: unknown) => void): void {
        reject('factory exploded')
      },
    }
    ctx.provide('agents', { create: () => rejected } as never)
    apply(ctx, { task: 't' })
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('abandons a run when the tree is disposed during Loader settlement', async () => {
    const ctx = new Context()
    let exited = false
    internals.stdout = { write: () => true }
    internals.stderr = { write: () => true }
    ctx.provide('appExit', () => { exited = true })
    const services = ctx.plugin((child: Context) => {
      child.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
      child.provide('sessions', {} as never)
      child.provide('agents', {} as never)
    })
    await services
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('loader', { await: () => settlement } as never)
    apply(ctx, { task: 't' })
    await services.dispose()
    release!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { task: 't' }) }).toThrow('must provide ctx.appExit')
  })

  it('validates config: the task is required', () => {
    expect(() => new Config({} as never)).toThrow()
    // The job-drain bound carries a default, so a bare config is not empty:
    // a run that waited for nothing unless a profile said otherwise would make
    // delivering a started job's result the opt-in rather than the behaviour.
    expect(new Config({ task: 'x' })).toEqual({ task: 'x', waitForJobsMs: 30_000 })
    expect(new Config({ task: 'x', waitForJobsMs: 0 }).waitForJobsMs).toBe(0)
    expect(() => new Config({ task: 'x', waitForJobsMs: -1 })).toThrow()
  })
})

describe('P9-06 Fault — acceptance[2], the exit-code matrix through the real runner', () => {
  // Each row drives the runner to one turn-end class and pins the code a script
  // sees. The unit table in scriptability.spec.ts pins the MAPPING; this pins
  // that the runner actually consults it, which is a different claim — a
  // correct table nothing reads produces exactly the old blanket 1.
  const rows = [
    { kind: 'completed', code: 0, named: false },
    { kind: 'blocked', code: 2, named: true },
    { kind: 'aborted', code: 3, named: true },
    { kind: 'max-tokens', code: 5, named: true },
    { kind: 'interrupted', code: 6, named: true },
  ] as const

  it.each(rows)('a $kind run exits $code', async ({ kind, code, named }) => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          // `aborted` carries a cause; the rest are bare discriminants, and the
          // union accepts each shape without help.
          reason: kind === 'aborted'
            ? { kind: 'aborted', reason: { kind: 'user' } }
            : { kind },
        })
      },
    })
    const result = await test.run()
    expect(result.code, `${kind} must exit ${code}`).toBe(code)
    // A completed run says nothing extra; every other class names itself, so a
    // script reading stderr never has to map a number back to a cause.
    expect(result.err.includes('run did not complete'), `${kind} stderr`).toBe(named)
    await test.ctx.fiber.dispose()
  })

  it('every non-completed class exits with a DISTINCT non-zero code, so the matrix is not decorative', () => {
    const codes = rows.filter(row => row.kind !== 'completed').map(row => row.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).not.toContain(0)
  })
})

/**
 * P9-03 Provider — `--model` reaches the agent, or the run stops.
 *
 * The Contract stage pinned the resolver; what it could not pin is that the
 * runner CALLS it, and calls it with the routes that really have an adapter.
 * These cases run the whole `apply` path, so a resolver wired to a hand-written
 * list, wired before the application settles, or not wired at all fails here.
 */
describe('P9-03 Provider — --model selects the route the run uses', () => {
  const answer: Script = {
    afterPrompt: (session, message) => { appendTurn(session, 1, message, 'answered', true) },
  }

  it('must[0]: a registered route and model become the agent\'s options', async () => {
    const test = await bench(answer, {
      routes: ['mock-a', 'mock-b'],
      config: { model: 'mock-b:some-model' },
    })
    expect(await test.run()).toMatchObject({ code: 0, out: 'answered\n' })
    expect(test.requested()).toMatchObject({ provider: 'mock-b', model: 'some-model' })
    await test.ctx.fiber.dispose()
  })

  it('acceptance[0]: the SAME task on a different --model differs only in the route it ran on', async () => {
    const first = await bench(answer, { routes: ['mock-a', 'mock-b'], config: { model: 'mock-a:m' } })
    expect(await first.run()).toMatchObject({ code: 0, out: 'answered\n' })
    const second = await bench(answer, { routes: ['mock-a', 'mock-b'], config: { model: 'mock-b:m' } })
    expect(await second.run()).toMatchObject({ code: 0, out: 'answered\n' })
    expect(first.requested()?.provider).toBe('mock-a')
    expect(second.requested()?.provider).toBe('mock-b')
    await first.ctx.fiber.dispose()
    await second.ctx.fiber.dispose()
  })

  it('acceptance[1]: an unregistered route exits non-zero and names the routes that exist', async () => {
    const test = await bench(answer, { routes: ['mock-a'], config: { model: 'nope:m' } })
    const result = await test.run()
    expect(result.code).toBe(1)
    expect(result.err).toContain('unregistered route "nope"')
    expect(result.err).toContain('available routes: mock-a')
    // Fail CLOSED: no agent was created, so the task never ran on the default
    // route while the user believed it ran on the one they named.
    expect(test.requested()).toBeUndefined()
    expect(result.out).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('acceptance[1]: a malformed argument fails the same way, rather than being read as a bare model', async () => {
    const test = await bench(answer, { routes: ['mock-a'], config: { model: 'just-a-model' } })
    const result = await test.run()
    expect(result.code).toBe(1)
    expect(result.err).toContain('must name a route and a model as "<provider>:<model>"')
    expect(test.requested()).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('without --model the configured default is used and nothing about the run changes', async () => {
    const test = await bench(answer, { routes: ['mock-a'] })
    expect(await test.run()).toMatchObject({ code: 0, out: 'answered\n' })
    expect(test.requested()).toMatchObject({ provider: 'test-provider', model: 'test-model' })
    await test.ctx.fiber.dispose()
  })
  // BLOCKED-220 丁: the run's completion condition does not include its jobs, so a
  // one-shot run can end with one still running. The loss is not fixed here; what
  // these cases hold is that it is RECORDED, and recorded while the run's output
  // can still name it.
  describe('background jobs still running when the run ends', () => {
    /**
     * A `jobs` service that reports exactly the snapshots a case hands it.
     * The registry's own behaviour is `dsh-jobs-local`'s and is tested there;
     * what this file owns is whether the runner reads the set and when.
     */
    function stubJobs(ctx: Context, snapshots: readonly { id: string; status: string }[]): void {
      ctx.provide('jobs', { list: () => snapshots, onJobDone: () => () => {} } as never)
    }

    /** A mutable registry stub whose jobs settle only when a case says so. */
    function controllableJobs(ctx: Context, ids: readonly string[]): {
      settle(id: string): void
      killed: string[]
    } {
      const live = new Map(ids.map(id => [id, 'running']))
      const listeners = new Set<(snapshot: { id: string; status: string }) => void>()
      const killed: string[] = []
      ctx.provide('jobs', {
        list: () => [...live].map(([id, status]) => ({ id, status })),
        onJobDone: (listener: (snapshot: { id: string; status: string }) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        kill: (id: string) => { killed.push(id); return 'requested' },
      } as never)
      return {
        settle: (id: string) => {
          live.set(id, 'completed')
          for (const listener of [...listeners]) listener({ id, status: 'completed' })
        },
        killed,
      }
    }

    /** The single session the bench's agent factory created. */
    function sessionOf(ctx: Context): Session {
      const session = ctx.agents.list()[0]?.session
      if (session === undefined) throw new Error('the bench created no agent')
      return session
    }

    it('names every job still running, before the session is flushed', async () => {
      // `waitForJobsMs: 0`: this case is about the RECORD, and a live job plus
      // a default bound would spend the whole bound before reaching it.
      const test = await bench(answer, { config: { waitForJobsMs: 0 } })
      stubJobs(test.ctx, [{ id: 'subagent-1', status: 'running' }, { id: 'bash-2', status: 'stopping' }])
      const warnings: string[] = []
      // `warn` is level 2 and an exporter's default threshold is INFO (1), so a
      // sink that does not raise it receives nothing.
      test.ctx.logger.exporter({
        levels: { default: LoggerLevel.WARN },
        export: (message) => {
          if (message.name !== 'headless') return
          warnings.push(String(message.args[0]))
        },
      })
      // Recorded through the same `order` channel the flush and exit use, so the
      // ordering claim is observed rather than asserted about the source.
      test.ctx.on('session/flush', () => { warnings.push('flush') })
      const result = await test.run()
      expect(result.code).toBe(0)
      expect(warnings[0]).toContain('subagent-1 (running), bash-2 (stopping)')
      expect(warnings[0]).toContain('2 background job(s) still running')
      expect(warnings[1]).toBe('flush')
      // The caller-visible half: one stderr line per job, and the durable
      // record the recorded-session harness projects those lines from.
      expect(result.err).toBe(
        'dsh: background job subagent-1 was still running when the run ended; its output was not collected\n'
        + 'dsh: background job bash-2 was still stopping when the run ended; its output was not collected\n',
      )
      const abandoned = sessionOf(test.ctx).snapshotEvents().filter(event => event.type === 'job/abandoned')
      expect(abandoned.map(event => event.data)).toStrictEqual([
        { jobId: 'subagent-1', status: 'running', surface: 'headless' },
        { jobId: 'bash-2', status: 'stopping', surface: 'headless' },
      ])
      await test.ctx.fiber.dispose()
    })

    // BLOCKED-220 甲: the run waits a bounded time for the jobs it started.
    it('waits for a job that settles inside the bound, and records no abandonment', async () => {
      const test = await bench(answer, { config: { waitForJobsMs: 5_000 } })
      const jobs = controllableJobs(test.ctx, ['bash-1'])
      // Settles a tick after the drain begins, which is the case the bound
      // exists to admit rather than to time out.
      queueMicrotask(() => { setTimeout(() => { jobs.settle('bash-1') }, 5) })
      const result = await test.run()

      expect(result.code).toBe(0)
      expect(result.err).toBe('')
      expect(sessionOf(test.ctx).snapshotEvents().filter(event => event.type === 'job/abandoned')).toStrictEqual([])
      expect(jobs.killed).toStrictEqual([])
      await test.ctx.fiber.dispose()
    })

    it('stops waiting at the bound without cancelling, and records what it left running', async () => {
      const test = await bench(answer, { config: { waitForJobsMs: 20 } })
      const jobs = controllableJobs(test.ctx, ['bash-1'])
      const result = await test.run()

      expect(result.code).toBe(0)
      // The bound stops the WAIT, never the job: cancelling on expiry would
      // turn a slow job into a killed one, which is what teardown does anyway.
      expect(jobs.killed).toStrictEqual([])
      expect(sessionOf(test.ctx).snapshotEvents()
        .filter(event => event.type === 'job/abandoned')
        .map(event => event.data))
        .toStrictEqual([{ jobId: 'bash-1', status: 'running', surface: 'headless' }])
      await test.ctx.fiber.dispose()
    })

    it('does not wait at all when the bound is 0, which stays expressible', async () => {
      const test = await bench(answer, { config: { waitForJobsMs: 0 } })
      const jobs = controllableJobs(test.ctx, ['bash-1'])
      const started = Date.now()
      await test.run()

      expect(Date.now() - started).toBeLessThan(1_000)
      expect(jobs.killed).toStrictEqual([])
      expect(sessionOf(test.ctx).snapshotEvents().filter(event => event.type === 'job/abandoned')).toHaveLength(1)
      await test.ctx.fiber.dispose()
    })

    it('records nothing when every job settled, so a clean run stays quiet', async () => {
      const test = await bench(answer)
      stubJobs(test.ctx, [{ id: 'subagent-1', status: 'completed' }, { id: 'bash-2', status: 'failed' }])
      const warnings: string[] = []
      test.ctx.logger.exporter({
        levels: { default: LoggerLevel.WARN },
        export: (message) => { if (message.name === 'headless') warnings.push(String(message.args[0])) },
      })
      expect(await test.run()).toMatchObject({ code: 0 })
      expect(warnings).toStrictEqual([])
      await test.ctx.fiber.dispose()
    })

    it('records nothing when the composition mounts no job registry at all', async () => {
      const test = await bench(answer)
      const warnings: string[] = []
      test.ctx.logger.exporter({
        levels: { default: LoggerLevel.WARN },
        export: (message) => { if (message.name === 'headless') warnings.push(String(message.args[0])) },
      })
      expect(await test.run()).toMatchObject({ code: 0 })
      expect(warnings).toStrictEqual([])
      await test.ctx.fiber.dispose()
    })
  })
})
