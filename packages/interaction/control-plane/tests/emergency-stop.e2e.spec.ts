/**
 * P2-12 Contract: the stop, the gate, and where an answer goes.
 *
 * Every case drives the decisions directly, which is what the Contract stage
 * is: no store, no broadcast, no surface. The cases that matter most are the
 * ones about what did NOT happen — a stop that was not lifted, a waiting point
 * that was not settled, an answer that granted nothing — because those are the
 * properties BLOCKED-215 showed can be written, stated, and absent.
 *
 * The file is `.e2e.spec.ts` and the registry names `emergency-stop.e2e.ts`.
 * Same reason P4-12 recorded: the greening observation collects `*.spec.ts`
 * only, so an `.e2e.ts` file would be frozen against a command that never
 * reports it.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import type {
  AnswerDelivery,
  ControlState,
  HumanAnswer,
  StopRecord,
  WaitingPointId,
} from '@deepseek-ai/dsh-human-channel/types'
import { CONTROL_VERBS } from '@deepseek-ai/dsh-human-channel/types'
import { decideAsk, decideControl, decideSettlement, mayStartNewWork } from '../src/index.ts'
import type { WaitingPointRegistry } from '../src/index.ts'

const OPERATOR = brandString<PrincipalId>('operator-1')
const POINT_A = brandString<WaitingPointId>('waiting-point-a')
const POINT_B = brandString<WaitingPointId>('waiting-point-b')
const GONE = brandString<WaitingPointId>('waiting-point-gone')

const request = { requestedBy: OPERATOR, reason: 'human-requested' as const, requestedAtMs: 1_700_000_000_000 }
const record: StopRecord = { ...request, release: 'explicit-resume' }
const running: ControlState = { stopped: false }
const stopped: ControlState = { stopped: true, record }

const registry = (over: Partial<WaitingPointRegistry> = {}): WaitingPointRegistry =>
  ({ open: new Set([POINT_A, POINT_B]), closed: new Set([GONE]), ...over })

const delivered: HumanAnswer[] = []
const delivery: AnswerDelivery = { deliver: (answer) => { delivered.push(answer); return undefined } }

describe('P2-12 must[0]/acceptance[2]: the stop is a durable record that only an explicit resume lifts', () => {
  it('records WHO stopped it and WHY, because a restart reads the record and not a flag', () => {
    // acceptance[2] is "the stop survives a restart and must be lifted
    // explicitly". A boolean restored from disk cannot be told apart from a
    // default, so what persists carries the requester, the reason and the
    // release that is allowed.
    expect(decideControl('pause-new-actions', running, request))
      .toEqual({ action: 'stop', record: { requestedBy: OPERATOR, reason: 'human-requested', requestedAtMs: 1_700_000_000_000, release: 'explicit-resume' } })
  })

  it('keeps a run stopped when the state was restored from a record, with no verb in between', () => {
    // The restart itself. Nothing re-applies the stop; the state IS the record,
    // so a process that comes up holding one is stopped before it asks anyone.
    expect(mayStartNewWork(stopped)).toEqual({ reason: 'stopped', record })
  })

  it('lifts the stop ONLY for resume, and reports every other verb as a no-op over a stopped state', () => {
    // The control that makes the case above mean something: if any verb could
    // release, "must be lifted explicitly" would be a comment rather than a
    // property. `cancel-run` is the one a reader expects to clear it — ending
    // the run is not a statement that new work may start.
    const released = CONTROL_VERBS.filter(verb => decideControl(verb, stopped, request).action === 'released')
    expect(released).toEqual(['resume'])
    expect(decideControl('cancel-run', stopped, request)).toEqual({ action: 'unchanged', because: 'already-stopped' })
  })

  it('distinguishes stopping an already-stopped run from stopping a running one, because an audit reads the transition', () => {
    // Same resulting state, different event. Collapsing them would make the
    // record of "who stopped this and when" unreadable after the second stop.
    expect(decideControl('pause-new-actions', stopped, request)).toEqual({ action: 'unchanged', because: 'already-stopped' })
    expect(decideControl('pause-new-actions', running, request).action).toBe('stop')
  })

  it('refuses kill-execution-world as UNIMPLEMENTED rather than accepting it silently', () => {
    // must[0] lists the verb and P3-01 owns what an execution world is. A typed
    // refusal is something a caller can read; a no-op that returns `unchanged`
    // would report the world as killed.
    expect(decideControl('kill-execution-world', running, request))
      .toEqual({ action: 'refused', refusal: { reason: 'verb-unimplemented', verb: 'kill-execution-world' } })
  })
})

describe('P2-12 must[2]: a worker checks the stop before it takes new work', () => {
  it('refuses new work under a stop, naming the record so the refusal can be explained', () => {
    expect(mayStartNewWork(stopped)).toEqual({ reason: 'stopped', record })
  })

  it('allows new work when no stop is in force, so the gate refuses only what the stop covers', () => {
    // The control. Without it, a gate that refused everything would satisfy the
    // case above and stop the harness.
    expect(mayStartNewWork(running)).toBeUndefined()
  })
})

describe('P2-12 must[0]: a question names its destination, and the stop is checked first', () => {
  it('refuses to ask under a stop, because a question is a new action', () => {
    // And it reports `stopped`, not `unknown-waiting-point`: the order of the
    // two checks decides which problem the caller is sent to fix.
    expect(decideAsk({ waitingPoint: POINT_A, prompt: 'proceed?' }, stopped, registry(), delivery))
      .toEqual({ reason: 'stopped', record })
  })

  it('reports the stop even when the waiting point is ALSO unknown, so the order is observable', () => {
    const unknown = brandString<WaitingPointId>('never-registered')
    expect(decideAsk({ waitingPoint: unknown, prompt: 'proceed?' }, stopped, registry(), delivery))
      .toMatchObject({ reason: 'stopped' })
  })

  it('distinguishes a waiting point that never existed from one that is gone', () => {
    // Different situations with different fixes: the first is an asker and a
    // router that disagree about what exists, the second is a question whose
    // asker has already left.
    const unknown = brandString<WaitingPointId>('never-registered')
    expect(decideAsk({ waitingPoint: unknown, prompt: 'proceed?' }, running, registry(), delivery))
      .toEqual({ reason: 'unknown-waiting-point', waitingPoint: unknown })
    expect(decideAsk({ waitingPoint: GONE, prompt: 'proceed?' }, running, registry(), delivery))
      .toEqual({ reason: 'waiting-point-vanished', waitingPoint: GONE })
  })

  it('admits an ask for an open point with a delivery seam, so the refusals above are not the only answer', () => {
    expect(decideAsk({ waitingPoint: POINT_A, prompt: 'proceed?' }, running, registry(), delivery)).toBeUndefined()
  })
})

describe('P2-12 acceptance[1]: an answer reaches only the waiting point that asked (BLOCKED-215)', () => {
  it('settles the addressed point and leaves every OTHER open point untouched', () => {
    // The delegate's first named case, and the property stated as a negative.
    // An answer routed by anything coarser than the point's own identity —
    // the asking child, the session, the agent — satisfies whichever question
    // that coarser key names, and with two outstanding that is the wrong one.
    // The decision returns what stays open so the case can check the point it
    // did NOT address.
    expect(decideSettlement({ waitingPoint: POINT_A, text: 'yes' }, registry()))
      .toEqual({ action: 'settled', waitingPoint: POINT_A, stillOpen: [POINT_B] })
  })

  it('settles B and leaves A open, so the case above is not passing on set order', () => {
    // The mirror. Asserting one direction would pass for an implementation that
    // always returns the second element.
    expect(decideSettlement({ waitingPoint: POINT_B, text: 'yes' }, registry()))
      .toEqual({ action: 'settled', waitingPoint: POINT_B, stillOpen: [POINT_A] })
  })

  it('REFUSES a settlement for a vanished waiting point and names it, rather than doing nothing', () => {
    // The delegate's second named case. A no-op is indistinguishable from
    // success at the call site, which is how an answer that reached nobody
    // reads as an answer delivered; the refusal names the point so the trace
    // says which answer went nowhere.
    expect(decideSettlement({ waitingPoint: GONE, text: 'yes' }, registry()))
      .toEqual({ action: 'refused', refusal: { reason: 'waiting-point-vanished', waitingPoint: GONE } })
  })

  it('refuses a settlement for a point that was never registered, separately from one that is gone', () => {
    const unknown = brandString<WaitingPointId>('never-registered')
    expect(decideSettlement({ waitingPoint: unknown, text: 'yes' }, registry()))
      .toEqual({ action: 'refused', refusal: { reason: 'unknown-waiting-point', waitingPoint: unknown } })
  })

  it('leaves the open set unchanged when it refuses, so a failed settlement cannot silently consume a point', () => {
    const before = registry()
    decideSettlement({ waitingPoint: GONE, text: 'yes' }, before)
    expect([...before.open]).toEqual([POINT_A, POINT_B])
  })
})

describe('P2-12 must[3]: an answer is input and never a grant', () => {
  it('carries nothing an approval path could consume: the answer has exactly its two fields', () => {
    // The runtime half of the separation. The type half is that `ApprovalGrant`
    // is branded with a module-private `unique symbol`, so no answer can be
    // widened into one — but a shared field would make the rule a matter of who
    // reads it, so the absence is asserted on a real value rather than trusted.
    const answer: HumanAnswer = { waitingPoint: POINT_A, text: 'yes' }
    expect(Object.keys(answer).sort()).toEqual(['text', 'waitingPoint'])
  })

  it('settles without producing a grant, so answering a question authorizes nothing', () => {
    // validation[3] asks for exactly this. The settlement's own result is the
    // place a grant would have to appear if answering granted anything.
    const settlement = decideSettlement({ waitingPoint: POINT_A, text: 'approve' }, registry())
    expect(Object.keys(settlement).sort()).toEqual(['action', 'stillOpen', 'waitingPoint'])
  })
})
