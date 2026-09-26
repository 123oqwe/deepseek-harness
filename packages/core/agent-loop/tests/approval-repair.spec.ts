// Crash repair closes an interrupted final turn's unanswered approvals as
// `cancelled`, inside the turn (P2-07 acceptance[0]): first the pure closer,
// then a resume through real persistence, read back from the stored log.

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ToolCallId, createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq, TOOL_NOT_STARTED, interruptedTurnClosers } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import { closeUnansweredApprovals } from '../src/approval-repair.ts'
import { MockAdapter } from './mock-adapter.ts'

const OPEN = ApprovalRequestId('ask-open')
const ANSWERED = ApprovalRequestId('ask-answered')
const EARLIER = ApprovalRequestId('ask-earlier-turn')
const CALL = ToolCallId('call-1')

/** An assistant message calling one tool, as a model step records it. */
const TOOL_CALL = createMessage({
  role: 'assistant',
  content: [{ type: 'tool-call', id: CALL, name: 'probe', arguments: '{}' }],
  source: { kind: 'model', provider: 'mock', model: 'mock' },
})

/**
 * A crashed log: one turn whose step called a tool and asked about it, the host dying before an answer.
 * @returns the log.
 */
function crashedWhileAsking(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: SessionSeq(1), time: 1, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: SessionSeq(2), time: 2, surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: TOOL_CALL } },
    { type: 'approval/asked', seq: SessionSeq(3), time: 2, data: { id: OPEN, toolName: 'probe', callId: CALL } },
  ] as SessionEvent[]
}

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

/**
 * Mount the loop over a JSONL store rooted at `root`.
 * @param root - the store's root directory.
 * @returns the mounted Context.
 */
async function mountLoop(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  // The backend mounts BEFORE the loop so teardown unwinds the loop first.
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  return ctx
}

describe('P2-07 acceptance[0]: crash repair decides an interrupted turn\'s unanswered approvals', () => {
  it('a balanced log has no closers, and none are added', () => {
    const balanced = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      { type: 'approval/asked', seq: SessionSeq(1), time: 1, data: { id: ANSWERED, toolName: 'probe' } },
      { type: 'approval/decided', seq: SessionSeq(2), time: 1, data: { id: ANSWERED, outcome: 'allowed-once' } },
      { type: 'turn/end', seq: SessionSeq(3), time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    const closers = interruptedTurnClosers(balanced)
    expect(closeUnansweredApprovals(balanced, closers)).toBe(closers)
    expect(closers).toEqual([])
  })

  it('an interrupted turn that left no ask unanswered keeps its closers unchanged', () => {
    const crashed = [
      ...crashedWhileAsking(),
      { type: 'approval/decided', seq: SessionSeq(4), time: 3, data: { id: OPEN, outcome: 'allowed-once' } },
    ] as SessionEvent[]
    const closers = interruptedTurnClosers(crashed)
    expect(closeUnansweredApprovals(crashed, closers)).toBe(closers)
  })

  it('the unanswered ask is decided cancelled after the tool closer and before the step and turn ends, with contiguous seqs', () => {
    const crashed = crashedWhileAsking()
    const repaired = closeUnansweredApprovals(crashed, interruptedTurnClosers(crashed))
    expect(repaired.map(event => [event.type, event.seq])).toEqual([
      ['tool/result', 4], ['approval/decided', 5], ['step/end', 6], ['turn/end', 7],
    ])
    expect(repaired[1]?.data).toEqual({ id: OPEN, outcome: 'cancelled' })
  })

  it('only the final turn\'s asks are decided: one an earlier turn left open is not', () => {
    const crashed = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      { type: 'approval/asked', seq: SessionSeq(1), time: 1, data: { id: EARLIER, toolName: 'probe' } },
      { type: 'turn/end', seq: SessionSeq(2), time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: SessionSeq(3), time: 2, data: { turn: 2 } },
      { type: 'step/start', seq: SessionSeq(4), time: 2, data: { turn: 2, step: 1 } },
    ] as SessionEvent[]
    const closers = interruptedTurnClosers(crashed)
    expect(closeUnansweredApprovals(crashed, closers)).toBe(closers)
  })

  it('with no open step, the decision goes before the turn end', () => {
    const crashed = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      { type: 'approval/asked', seq: SessionSeq(1), time: 1, data: { id: OPEN, toolName: 'workspace-trust' } },
    ] as SessionEvent[]
    const repaired = closeUnansweredApprovals(crashed, interruptedTurnClosers(crashed))
    expect(repaired.map(event => [event.type, event.seq])).toEqual([['approval/decided', 2], ['turn/end', 3]])
  })

  it('resume stores the decision durably, inside the interrupted turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-approval-repair-'))
    dirs.push(root)
    const sessionId = SessionId('crashed-while-asking')
    const first = await mountLoop(root)
    const detached = first.sessions.prepare(sessionId)
    const writer = await first.sessionPersistence.create(detached.header)
    await writer.append(crashedWhileAsking())
    await writer.close()
    await first.fiber.dispose()

    const second = await mountLoop(root)
    const resumed = await second.agents.resume({ resumeSessionId: sessionId })
    await resumed.dispose()
    const reader = await second.sessionPersistence.open(sessionId, 'read')
    const stored = (await reader.read()).events
    await reader.close()
    await second.fiber.dispose()

    expect(stored.map(event => event.type)).toEqual([
      'turn/start', 'step/start', 'assistant/message', 'approval/asked',
      'tool/result', 'approval/decided', 'step/end', 'turn/end', 'session/end-seed',
    ])
    expect(stored.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(stored[4]).toMatchObject({ data: { error: { code: TOOL_NOT_STARTED } } })
    expect(stored[5]?.data).toEqual({ id: OPEN, outcome: 'cancelled' })
  })
})
