/**
 * Epic P3-03 U1 in the session log: a `tool/result` records how its execution
 * did not succeed as one of six kinds, the log refuses any other, and crash
 * repair records how each call it closes ended.
 */
import { describe, expect, it } from 'vitest'
import { createMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import {
  interruptedTurnClosers, Session, SessionId, SessionSeq, TOOL_OUTCOME_UNKNOWN, TOOL_RESULT_OUTCOME_KINDS,
  type SessionEvent, type ToolResultOutcome,
} from '../src/index.ts'

/** A session whose model asked for call `c1`, ready for its result. */
function awaitingResult(): Session {
  const session = Session.create(SessionId('outcome-session'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    stream: [],
    turn: 1, step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'bash', arguments: '{}' }],
      source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
    }),
  }, { surfaceOp: 'append' })
  return session
}

/**
 * Append call `c1`'s error result with `outcome`.
 * @param session - a session awaiting the result.
 * @param outcome - the outcome to record.
 */
function appendResult(session: Session, outcome: unknown): void {
  session.append('tool/result', {
    turn: 1, step: 1,
    message: createToolResultMessage({ callId: ToolCallId('c1'), content: [{ type: 'text', text: 'Error: no' }], isError: true }),
    outcome: outcome as ToolResultOutcome,
  }, { surfaceOp: 'append' })
}

describe('P3-03 U1: a tool result records one of six outcome kinds', () => {
  it('records each kind and refuses any other, or an outcome that is not an object', () => {
    const outcomes: ToolResultOutcome[] = [
      { kind: 'policy_denied', source: 'policy', name: 'PolicyRefusedError' },
      { kind: 'resource_exhausted', limit: 'memory' },
      { kind: 'timeout', by: 'executor', deadlineMs: 1000 },
      { kind: 'cancelled', by: 'abort' },
      { kind: 'tool_failed', exitCode: 2 },
      { kind: 'world_lost', reason: 'lost-contact' },
    ]
    expect(outcomes.map(outcome => outcome.kind)).toEqual([...TOOL_RESULT_OUTCOME_KINDS])
    for (const outcome of outcomes) {
      const session = awaitingResult()
      appendResult(session, outcome)
      const last = session.snapshotEvents().at(-1)
      expect(last?.type === 'tool/result' ? last.data.outcome : undefined).toEqual(outcome)
    }
    expect(() => { appendResult(awaitingResult(), { kind: 'denied' }) }).toThrow(/outcome must be an object whose kind is one of policy_denied, /)
    expect(() => { appendResult(awaitingResult(), 'policy_denied') }).toThrow(/outcome must be an object/)
  })
})

describe('P3-03 U1: crash repair records how each call it closes ended', () => {
  /** The events of an interrupted turn whose model asked for `call`, with its `tool/call` recorded when `started`. */
  function interrupted(started: boolean): SessionEvent[] {
    const events: unknown[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, data: {
        turn: 1, step: 1, stream: [],
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'tool-call', id: ToolCallId('call'), name: 'bash', arguments: '{}' }],
          source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
        }),
      } },
      ...started ? [{ type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: ToolCallId('call'), name: 'bash', arguments: '{}' } }] : [],
    ]
    for (const event of events as { seq: number }[]) SessionSeq(event.seq)
    return events as SessionEvent[]
  }

  it('records a call whose outcome is unknown as a tool failure, which nothing retries on its own, and one that never started as interrupted', () => {
    const [unknown] = interruptedTurnClosers(interrupted(true))
    expect(unknown?.type === 'tool/result' ? unknown.data.outcome : undefined).toEqual({ kind: 'tool_failed', code: TOOL_OUTCOME_UNKNOWN })
    const [notStarted] = interruptedTurnClosers(interrupted(false))
    expect(notStarted?.type === 'tool/result' ? notStarted.data.outcome : undefined).toEqual({ kind: 'cancelled', by: 'interrupt' })
  })
})
