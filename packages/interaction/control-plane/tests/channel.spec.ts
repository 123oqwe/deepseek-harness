/**
 * P2-12 Provider: the stop that outlives the process, and the registry that
 * owns what is pending.
 *
 * The Contract stage's cases drive pure decisions. These drive the composition
 * — a real store on a real directory, a real broadcast, a real delivery seam —
 * because the three properties this stage owes are all about ORDER and
 * SURVIVAL, and neither is observable in a pure function: the write precedes
 * the report, a restart reads the record, and only an explicit release that is
 * itself persisted lets work start again.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import { openStopStore } from '@deepseek-ai/dsh-human-channel/store'
import type {
  AnswerDelivery,
  ControlState,
  HumanAnswer,
  WaitingPointId,
} from '@deepseek-ai/dsh-human-channel/types'
import { createHumanChannel } from '../src/channel.ts'
import type { ControlRequest, HumanChannel } from '../src/channel.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'human-channel-'))
  roots.push(dir)
  return dir
}

const OPERATOR = brandString<PrincipalId>('operator-1')
const POINT_A = brandString<WaitingPointId>('waiting-point-a')
const POINT_B = brandString<WaitingPointId>('waiting-point-b')
const request: ControlRequest = { requestedBy: OPERATOR, reason: 'human-requested', requestedAtMs: 1_700_000_000_000 }

/** One channel over a real directory, recording what it broadcast and delivered. */
function channel(dir: string): { channel: HumanChannel; broadcasts: ControlState[]; delivered: HumanAnswer[] } {
  const broadcasts: ControlState[] = []
  const delivered: HumanAnswer[] = []
  const delivery: AnswerDelivery = { deliver: (answer) => { delivered.push(answer); return undefined } }
  return {
    channel: createHumanChannel({ store: openStopStore(dir), broadcast: (state) => { broadcasts.push(state) }, delivery }),
    broadcasts,
    delivered,
  }
}

describe('P2-12 acceptance[2]: the stop survives a restart and needs an explicit release', () => {
  it('comes up STOPPED over a store that holds a record, with nothing re-applying the stop', () => {
    // The restart itself. A second channel is a new process as far as this
    // property is concerned: it reads the record at construction, so the first
    // question after a restart is not answered as if the run were running.
    const dir = directory()
    channel(dir).channel.control('pause-new-actions', request)
    expect(channel(dir).channel.mayStartNewWork()).toMatchObject({ reason: 'stopped' })
  })

  it('lets work start again only after a resume, and that release survives the next restart too', () => {
    // Both directions. Without the second half, a release that was never
    // persisted would read as success and the stop would come back.
    const dir = directory()
    const first = channel(dir).channel
    first.control('pause-new-actions', request)
    expect(first.control('resume', request)).toEqual({ action: 'released' })
    expect(first.mayStartNewWork()).toBeUndefined()
    expect(channel(dir).channel.mayStartNewWork()).toBeUndefined()
  })

  it('keeps the stop when a RELEASE was decided but never reached the store, which is the reverse control', () => {
    // The failure the second half above is written against, constructed: the
    // record is still on disk, so a restart is stopped regardless of what the
    // previous process believed it had done. A release that is reported without
    // being persisted is the same lie as a stop that is, in the other
    // direction.
    const dir = directory()
    channel(dir).channel.control('pause-new-actions', request)
    const persisted = readFileSync(join(dir, 'emergency-stop.json'), 'utf8')
    channel(dir).channel.control('resume', request)
    writeFileSync(join(dir, 'emergency-stop.json'), persisted, 'utf8')
    expect(channel(dir).channel.mayStartNewWork()).toMatchObject({ reason: 'stopped' })
  })

  it('refuses a store document whose version this build does not know, naming the path and both versions', () => {
    // The pre-release stance, and BLOCKED-221's precedent. A record this build
    // cannot read might be a stop in force, so guessing either way is worse
    // than refusing — this is the one object where failing closed and failing
    // loud are the same choice.
    const dir = directory()
    const path = join(dir, 'emergency-stop.json')
    writeFileSync(path, JSON.stringify({ version: 99, record: null }), 'utf8')
    expect(() => openStopStore(dir).read()).toThrow(/emergency-stop\.json is stop-format version 99, not 1/u)
  })

  it('reads a missing document as "no stop", because a first boot is not a failure', () => {
    // The control for the refusal above: if an absent file threw, no profile
    // could ever start.
    expect(openStopStore(directory()).read()).toBeUndefined()
  })
})

describe('P2-12 must[1]: the stop is persisted BEFORE it is announced', () => {
  it('has the record on disk by the time the broadcast fires', () => {
    // The order is the contract, and a broadcast listener is the only place
    // from which "already written?" can be asked at the right instant. A report
    // that outlives its record is a lie the next process cannot detect: every
    // worker was told to halt and the file says nothing was stopped.
    const dir = directory()
    const seen: (string | undefined)[] = []
    const store = openStopStore(dir)
    const live = createHumanChannel({
      store,
      broadcast: () => {
        seen.push(store.read() === undefined ? undefined : 'record-present')
      },
      delivery: { deliver: () => undefined },
    })
    live.control('pause-new-actions', request)
    expect(seen).toEqual(['record-present'])
  })

  it('keeps a stop that was announced and then lost the process, so a crash between the two does not forget it', () => {
    // The CONSEQUENCE of the order, not just the order. The broadcast throws,
    // which is what a process dying at that instant looks like from inside
    // `commit`; the record must already be on disk, so the replacement comes up
    // stopped. With the write moved after the broadcast this is the "announced
    // but never persisted" stop that every worker was told about and no restart
    // can find.
    const dir = directory()
    const crashing = createHumanChannel({
      store: openStopStore(dir),
      broadcast: () => { throw new Error('the process died while announcing') },
      delivery: { deliver: () => undefined },
    })
    expect(() => crashing.control('pause-new-actions', request)).toThrow(/died while announcing/u)
    expect(channel(dir).channel.mayStartNewWork()).toMatchObject({ reason: 'stopped' })
  })

  it('announces every transition and nothing else, so a no-op does not look like a stop', () => {
    const dir = directory()
    const { channel: live, broadcasts } = channel(dir)
    live.control('pause-new-actions', request)
    live.control('pause-new-actions', request)
    live.control('cancel-run', request)
    live.control('resume', request)
    expect(broadcasts.map(state => state.stopped)).toEqual([true, false])
  })
})

describe('P2-12 must[2]/acceptance[0]: no new work starts under a stop', () => {
  it('refuses to register a question under a stop, because a question is new work', () => {
    const dir = directory()
    const { channel: live } = channel(dir)
    live.control('pause-new-actions', request)
    expect(live.ask({ waitingPoint: POINT_A, prompt: 'proceed?' })).toMatchObject({ reason: 'stopped' })
    expect(live.pending()).toEqual([])
  })

  it('registers a question when no stop is in force, so the refusal above is not the only answer', () => {
    const { channel: live } = channel(directory())
    expect(live.ask({ waitingPoint: POINT_A, prompt: 'proceed?' })).toBeUndefined()
    expect(live.pending()).toEqual([POINT_A])
  })
})

describe('P2-12 acceptance[1]: settlement is out of band and reaches one point only', () => {
  it('delivers to the point that asked and leaves the other pending', () => {
    // Out of band: the answer arrives at `settle` from a surface, not from the
    // asking call stack, so the waiting point is the only thing it can be
    // matched by.
    const { channel: live, delivered } = channel(directory())
    live.ask({ waitingPoint: POINT_A, prompt: 'a?' })
    live.ask({ waitingPoint: POINT_B, prompt: 'b?' })
    expect(live.settle({ waitingPoint: POINT_A, text: 'yes' })).toBeUndefined()
    expect(delivered).toEqual([{ waitingPoint: POINT_A, text: 'yes' }])
    expect(live.pending()).toEqual([POINT_B])
  })

  it('refuses a SECOND answer for the same point as vanished, not as never registered', () => {
    // A surface that delivered twice and a surface that invented an id need
    // different answers, and a settled point is the first case.
    const { channel: live } = channel(directory())
    live.ask({ waitingPoint: POINT_A, prompt: 'a?' })
    live.settle({ waitingPoint: POINT_A, text: 'yes' })
    expect(live.settle({ waitingPoint: POINT_A, text: 'again' }))
      .toEqual({ reason: 'waiting-point-vanished', waitingPoint: POINT_A })
  })

  it('refuses an answer for a point nobody registered, and delivers nothing', () => {
    const { channel: live, delivered } = channel(directory())
    const unknown = brandString<WaitingPointId>('never-registered')
    expect(live.settle({ waitingPoint: unknown, text: 'yes' }))
      .toEqual({ reason: 'unknown-waiting-point', waitingPoint: unknown })
    expect(delivered).toEqual([])
  })

  it('refuses to re-ask a settled point, so the registry does not quietly reopen it', () => {
    const { channel: live } = channel(directory())
    live.ask({ waitingPoint: POINT_A, prompt: 'a?' })
    live.settle({ waitingPoint: POINT_A, text: 'yes' })
    expect(live.ask({ waitingPoint: POINT_A, prompt: 'a again?' }))
      .toEqual({ reason: 'waiting-point-vanished', waitingPoint: POINT_A })
  })
})
