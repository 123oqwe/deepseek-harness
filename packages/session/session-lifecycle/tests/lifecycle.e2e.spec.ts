/**
 * Epic P6-07's Fault stage: what the session-lifecycle recovery path does when
 * its inputs are hostile rather than merely unusual.
 *
 * Two subjects, both declared by this stage: `readSessionLogWithRepair`
 * (acceptance[3]'s corrupted-log entry point) and
 * `packages/core/session/src/repair.ts`'s `interruptedTurnClosers` (the
 * crash-tail repair the same clause's doc comment names as its sibling).
 *
 * Every case declares its category in its title, because "all cases pass" means
 * something different for each and the distinction is not recoverable from a
 * count:
 *
 * - `enforcement:` asserts a refusal or a bound the code must uphold. Breaking
 *   the subject must turn it red.
 * - `control:` asserts the legitimate path still works, so the enforcement
 *   cases above measure a decision rather than a dead code path. A verifier
 *   that refuses everything satisfies most negative cases; only these separate
 *   it from a correct one.
 * - `DEFECT:` records behaviour that is wrong today and is NOT fixed here,
 *   because the fix lies outside this stage's declared files. Green means the
 *   defect is still present exactly as described.
 * - `CHARACTERIZATION:` pins current behaviour that is neither clearly correct
 *   nor a defect, so a later change cannot alter it silently.
 *
 * A `DEFECT:` or `CHARACTERIZATION:` case passing against unfixed code is the
 * correct result, not a vacuous assertion.
 */

import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN, interruptedTurnClosers } from '@deepseek-ai/dsh-session'
import { readSessionLogWithRepair } from '../src/index.ts'
import type { RawSessionLogLine } from '../src/index.ts'

const SESSION = SessionId('01JBQ0000000000000000P607F')

/**
 * A minimal well-formed event row at `seq`.
 * @param seq - the sequence number to stamp.
 * @returns a parsed log line the reader accepts.
 */
function okLine(seq: number): RawSessionLogLine {
  return {
    ok: true,
    event: { type: 'turn/start', seq: SessionSeq(seq), time: 1, data: { turn: seq } } as SessionEvent,
  }
}

/**
 * An unreadable row carrying the evidence the reader must surface.
 * @param lineNumber - the 1-based row index to report.
 * @param raw - the row's raw text.
 * @returns a failed log line.
 */
function badLine(lineNumber: number, raw = '{"type":'): RawSessionLogLine {
  return { ok: false, lineNumber, raw, parseError: 'unparsable JSON: Unexpected end of JSON input' }
}

describe('P6-07 Fault — corrupted-log reads', () => {
  it('control: a log whose every row parses recovers fully, so the truncation cases below measure a decision', () => {
    const result = readSessionLogWithRepair(SESSION, [okLine(1), okLine(2), okLine(3)])
    expect(result.recoverable).toBe('full')
    if (result.recoverable !== 'full') throw new Error('unreachable')
    expect(result.events).toHaveLength(3)
  })

  it('enforcement: recovery stops at the first unreadable row and never resumes past it, even when later rows parse', () => {
    const result = readSessionLogWithRepair(SESSION, [okLine(1), okLine(2), badLine(3), okLine(4), okLine(5)])
    expect(result.recoverable).toBe('partial')
    if (result.recoverable !== 'partial') throw new Error('unreachable')
    // The two rows after the corruption are individually well-formed. Including
    // them is the failure this asserts against: a corrupt intermediate record
    // can change how later records must be interpreted, so a prefix is the only
    // honest answer.
    expect(result.events).toHaveLength(2)
    expect(result.recoveredThroughSeq).toBe(2)
  })

  it('enforcement: a corruption on the very first row recovers nothing rather than reporting an empty success', () => {
    const result = readSessionLogWithRepair(SESSION, [badLine(1), okLine(2)])
    // `{recoverable:'full', events:[]}` would be indistinguishable from an empty
    // log to every caller, which is the misreport this clause exists to prevent.
    expect(result.recoverable).toBe('none')
  })

  it('enforcement: the evidence names the exact row and reason, not a summary', () => {
    const result = readSessionLogWithRepair(SESSION, [okLine(1), badLine(2, '{"type":"turn/en')])
    if (result.recoverable !== 'partial') throw new Error('expected partial')
    expect(result.evidence.lineNumber).toBe(2)
    expect(result.evidence.raw).toBe('{"type":"turn/en')
    expect(result.evidence.parseError).toContain('unparsable JSON')
  })

  it('DEFECT: the reader copies the caller-supplied raw row into evidence with no bound of its own, so a large corrupt row is retained whole', () => {
    const huge = 'x'.repeat(100_000)
    const result = readSessionLogWithRepair(SESSION, [okLine(1), badLine(2, huge)])
    if (result.recoverable !== 'partial') throw new Error('expected partial')
    // `CorruptedLogEvidence.raw` is documented in the persistence package as
    // "truncated to CORRUPTION_RAW_LIMIT" (512). That truncation happens only in
    // the JSONL scanner. This entry point applies no bound at all, so any other
    // producer of RawSessionLogLine hands through an unbounded row.
    // Fixing it means bounding here or making the bound part of the type, both
    // outside this stage's declared files.
    expect(result.evidence.raw).toHaveLength(100_000)
  })

  it('DEFECT: evidence never names the session it came from, because the entry point discards its own sessionId', () => {
    const result = readSessionLogWithRepair(SESSION, [badLine(1)])
    if (result.recoverable !== 'none') throw new Error('expected none')
    // `readSessionLogWithRepair` begins `void sessionId`. Evidence that cannot
    // say which session was corrupt is weaker than the clause implies once more
    // than one session is being recovered.
    expect(Object.keys(result.evidence).sort()).toEqual(['lineNumber', 'parseError', 'raw'])
    expect(JSON.stringify(result.evidence)).not.toContain(SESSION)
  })

  it('CHARACTERIZATION: an empty log is a full recovery of nothing, not a corruption', () => {
    const result = readSessionLogWithRepair(SESSION, [])
    expect(result.recoverable).toBe('full')
  })
})

describe('P6-07 Fault — interrupted-tail repair', () => {
  /**
   * A crash-tail log: turn and step opened, one tool call requested, nothing closed.
   * @param withCallStart - whether the `tool/call` row was durably recorded.
   * @returns the events to repair.
   */
  function interruptedLog(withCallStart: boolean): SessionEvent[] {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(1), time: 10, data: { turn: 1 } },
      { type: 'step/start', seq: SessionSeq(2), time: 11, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message',
        seq: SessionSeq(3),
        time: 12,
        data: { turn: 1, step: 1, message: { id: 'm1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read', input: {} }] } },
      } as unknown as SessionEvent,
    ]
    if (withCallStart) {
      events.push({ type: 'tool/call', seq: SessionSeq(4), time: 13, data: { turn: 1, step: 1, callId: 'call-1' } } as unknown as SessionEvent)
    }
    return events
  }

  it('control: a balanced log needs no repair, so the closers below are produced by the interruption and not unconditionally', () => {
    const balanced: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(1), time: 10, data: { turn: 1 } },
      { type: 'turn/end', seq: SessionSeq(2), time: 11, data: { turn: 1, reason: { kind: 'complete' } } } as unknown as SessionEvent,
    ]
    expect(interruptedTurnClosers(balanced)).toEqual([])
  })

  it('control: an empty log produces no closers rather than a fabricated turn', () => {
    expect(interruptedTurnClosers([])).toEqual([])
  })

  it('enforcement: a tool call recorded as started is closed as outcome-unknown, never as a plain failure', () => {
    const closers = interruptedTurnClosers(interruptedLog(true))
    const result = closers.find(e => e.type === 'tool/result')
    expect(result).toBeDefined()
    // The distinction is load-bearing: a call that reached the tool may have had
    // side effects, so the model must not be told it simply failed.
    expect((result as { data: { error: { code: string } } }).data.error.code).toBe(TOOL_OUTCOME_UNKNOWN)
  })

  it('enforcement: a tool call never recorded as started is closed as not-started, which is safe to retry', () => {
    const closers = interruptedTurnClosers(interruptedLog(false))
    const result = closers.find(e => e.type === 'tool/result')
    expect((result as { data: { error: { code: string } } }).data.error.code).toBe(TOOL_NOT_STARTED)
  })

  it('enforcement: closers are emitted in provider-valid order — tool results, then step/end, then turn/end', () => {
    const closers = interruptedTurnClosers(interruptedLog(true))
    expect(closers.map(e => e.type)).toEqual(['tool/result', 'step/end', 'turn/end'])
  })

  it('enforcement: synthetic sequences continue the log without colliding with a real one', () => {
    const closers = interruptedTurnClosers(interruptedLog(true))
    expect(closers.map(e => e.seq)).toEqual([5, 6, 7])
  })

  it('enforcement: synthetic closers reuse the last real timestamp and never invent a later one', () => {
    const events = interruptedLog(true)
    const lastTime = events.at(-1)?.time
    for (const closer of interruptedTurnClosers(events)) expect(closer.time).toBe(lastTime)
  })

  it('DEFECT: sequences are derived from the LAST array element, not the highest seq, so an out-of-order log yields colliding closers', () => {
    const outOfOrder: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(1), time: 10, data: { turn: 1 } },
      { type: 'step/start', seq: SessionSeq(9), time: 11, data: { turn: 1, step: 1 } },
      { type: 'step/end', seq: SessionSeq(2), time: 12, data: { turn: 1, step: 1 } } as unknown as SessionEvent,
    ]
    const closers = interruptedTurnClosers(outOfOrder)
    // seq 3 is below the log's existing maximum of 9, so replaying this repaired
    // log renumbers or rejects. The reader that produces `events` sorts, so this
    // is not reachable today through the shipped path; it is a latent contract
    // gap in a function whose signature accepts any array.
    expect(closers.map(e => e.seq)).toEqual([3])
  })

  it('CHARACTERIZATION: a step that closed cleanly drops its pending calls, so only the open tail is repaired', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(1), time: 10, data: { turn: 1 } },
      { type: 'step/start', seq: SessionSeq(2), time: 11, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message',
        seq: SessionSeq(3),
        time: 12,
        data: { turn: 1, step: 1, message: { id: 'm1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read', input: {} }] } },
      } as unknown as SessionEvent,
      { type: 'step/end', seq: SessionSeq(4), time: 13, data: { turn: 1, step: 1 } } as unknown as SessionEvent,
    ]
    // A logged step/end means the step completed, so its calls are not dangling.
    expect(interruptedTurnClosers(events).map(e => e.type)).toEqual(['turn/end'])
  })
})
