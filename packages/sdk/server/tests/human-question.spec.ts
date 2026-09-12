/**
 * P2-12 must[0] over the SDK: the runtime asks its embedding host, and the
 * answer comes back to the asking turn.
 *
 * **What these cases prove, stated narrowly on purpose.** They show the
 * MECHANISM reaches: a question put through `ctx.userQuestions.ask` leaves as the
 * protocol's first server-to-client request, and the host's reply resolves the
 * asker. The handler here is a test-side stand-in for an embedding host, so this
 * is 4.4b evidence — what the service can do — and NOT 4.4c. Production reach is
 * the Web surface's to prove, through the real `ui-user-questions` answerer, and
 * these two facts are cited separately in `evidence-P2-12.md` rather than merged
 * into "the SDK supports questions".
 *
 * The shipped default is the opposite of these cases: nothing in this repository
 * registers a `human/question` handler, so the last case is the one a deployment
 * meets.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { HumanQuestionParams, HumanQuestionResult, JsonRpcTransportPeer } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

/** A host that answers `human/question`, or refuses it the way one with no handler does. */
class HostTransport implements JsonRpcTransportPeer {
  readonly asked: HumanQuestionParams[] = []

  constructor(private readonly answer: HumanQuestionResult | 'no-handler') {}

  request(method: string, params: object): Promise<unknown> {
    if (method !== 'human/question') throw new Error(`unexpected host method ${method}`)
    this.asked.push(params as HumanQuestionParams)
    // The shape of a host with no handler: JSON-RPC method-not-found, which is
    // what the transport surfaces as a rejection rather than as an empty answer.
    if (this.answer === 'no-handler') return Promise.reject(new Error('Method not found: human/question'))
    return Promise.resolve(this.answer)
  }

  notify(): void {
    // Notifications are irrelevant here and are dropped rather than recorded:
    // these cases are about one request and its reply.
  }
}

/** A live context with an agent, the user-questions seam, and the SDK server mounted. */
async function harness(transport: JsonRpcTransportPeer) {
  const storageDir = await mkdtemp(join(tmpdir(), 'dsh-human-question-'))
  roots.push(storageDir)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(UserQuestionService)
  const server = new HarnessSdkJsonRpcServer(ctx, transport)
  const handle = await ctx.agents.create({ sessionId: SessionId('human-question-session'), meta: { cwd: storageDir } })
  return { ctx, server, agent: handle.agent }
}

describe('P2-12 must[0] over the SDK: the runtime asks its embedding host', () => {
  it('sends the question as a server-to-client request and resolves the asker with the reply', async () => {
    const transport = new HostTransport({ answers: [{ id: 'q1', selected: ['ship it'] }] })
    const { ctx, agent } = await harness(transport)
    const answer = await ctx.userQuestions.ask({
      agent,
      questions: [{ id: 'q1', question: 'Ship?', options: [{ label: 'ship it' }, { label: 'hold' }] }],
    })
    expect(answer).toEqual({ answers: [{ id: 'q1', selected: ['ship it'] }] })
    expect(transport.asked).toEqual([{
      sessionId: 'human-question-session',
      questions: [{ id: 'q1', question: 'Ship?', options: [{ label: 'ship it' }, { label: 'hold' }] }],
    }])
  })

  it('names the session on the wire, so a host driving several can attribute the question', async () => {
    const transport = new HostTransport({ answers: [{ id: 'q1', selected: [], custom: 'later' }] })
    const { ctx, agent } = await harness(transport)
    await ctx.userQuestions.ask({ agent, questions: [{ id: 'q1', question: 'When?' }] })
    expect(transport.asked[0]?.sessionId).toBe('human-question-session')
  })

  it('carries free text back, so a question with no options is answerable', async () => {
    const transport = new HostTransport({ answers: [{ id: 'q1', selected: [], custom: 'next week' }] })
    const { ctx, agent } = await harness(transport)
    await expect(ctx.userQuestions.ask({ agent, questions: [{ id: 'q1', question: 'When?' }] }))
      .resolves.toEqual({ answers: [{ id: 'q1', selected: [], custom: 'next week' }] })
  })

  it('FAILS CLOSED when the host registers no handler, which is the shipped default', async () => {
    // Nothing in this repository answers `human/question`. A host that does not
    // either is refused by method-not-found, the answerer delegates, and the
    // chain ends at the user-questions service's own refusal — not at a
    // fabricated answer and not at a hang.
    const transport = new HostTransport('no-handler')
    const { ctx, agent } = await harness(transport)
    await expect(ctx.userQuestions.ask({ agent, questions: [{ id: 'q1', question: 'Ship?' }] }))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
    expect(transport.asked).toHaveLength(1)
  })
})
