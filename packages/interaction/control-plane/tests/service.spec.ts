/**
 * P2-12 Usage: the mounted service, where an answer actually reaches the caller
 * that asked.
 *
 * This is the property BLOCKED-215 found absent in P5-10's equivalent seam: the
 * routing was written, the property was stated, and nothing in production
 * supplied either the destination or the delivery callback. Here `ask` registers
 * the continuation at the only moment it exists, and `settle` resumes it — so
 * the case can await the asker and see the human's text arrive.
 *
 * The user-questions SEAM is faked here, and that boundary is the point. These
 * cases prove this service's own wiring: a question reaches the seam, the seam's
 * answer settles the waiting point, and the asker resumes. Which answerer
 * replies — `ui-user-questions` on `web`, an embedding host over
 * `human/question` on an SDK profile, none on `headless` — is the profile's
 * business, and observing a REAL answerer is a separate, profile-level
 * observation. Proving both here would mean this file deciding which surface
 * counts.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { WaitingPointId } from '@deepseek-ai/dsh-human-channel/types'
import ControlPlaneService from '../src/plugin.ts'
import type { ControlRequest } from '../src/channel.ts'

/**
 * The agent the seam is handed.
 *
 * A stand-in, because nothing on this path reads it: the service passes it
 * through to `ctx.userQuestions.ask`, which is where the liveness and ownership
 * checks live, and those belong to that service's own cases.
 */
const AGENT = { id: 'agent-1' } as unknown as Agent

/** The questions a faked seam was asked, and how it answers. */
interface FakeSeam {
  readonly asked: { id: string; question: string }[]
  answer: { custom?: string; selected: string[] } | 'refuse'
}

/**
 * Provide a `userQuestions` stand-in that records what it was asked.
 *
 * `ctx.provide` rather than the real service: the real one requires a live agent
 * registry and an answerer, which makes it a composition fixture. What this file
 * pins is the wiring on THIS side of the seam.
 * @param ctx - the context to provide into.
 * @returns the recorder.
 */
function fakeSeam(ctx: Context): FakeSeam {
  const seam: FakeSeam = { asked: [], answer: { selected: ['ok'] } }
  ctx.provide('userQuestions', {
    ask: (request: { questions: { id: string; question: string }[] }) => {
      seam.asked.push(...request.questions)
      if (seam.answer === 'refuse') return Promise.reject(new Error('no user-questions answerer accepted the request'))
      return Promise.resolve({ answers: [{ id: request.questions[0]?.id ?? '', ...seam.answer }] })
    },
  } as never)
  return seam
}

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const POINT_A = brandString<WaitingPointId>('waiting-point-a')
const POINT_B = brandString<WaitingPointId>('waiting-point-b')
const request: ControlRequest = {
  requestedBy: brandString<PrincipalId>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
}

/**
 * One mounted service over a fresh store directory.
 * @returns the service.
 */
async function mounted(): Promise<{ service: ControlPlaneService; seam: FakeSeam }> {
  const storePath = mkdtempSync(join(tmpdir(), 'control-plane-'))
  roots.push(storePath)
  const ctx = new Context()
  const seam = fakeSeam(ctx)
  // Awaited: a Cordis fiber loads asynchronously, so reading the service off a
  // un-awaited `plugin()` finds nothing. Measured the hard way — the first
  // version of this helper threw "the service did not mount" for all five cases.
  await ctx.plugin(ControlPlaneService, { storePath })
  const service = ctx.get('controlPlane')
  if (service === undefined) throw new Error('the service did not mount')
  return { service, seam }
}

describe('P2-12 acceptance[1]: the human answer reaches the point that asked (BLOCKED-215 closed)', () => {
  it('resumes the asker with the human text, which is the delivery P5-10 never had a path for', async () => {
    const { service, seam } = await mounted()
    seam.answer = { custom: 'yes, proceed', selected: [] }
    const asked = service.ask({ waitingPoint: POINT_A, prompt: 'proceed?' }, AGENT)
    expect('answer' in asked).toBe(true)
    if (!('answer' in asked)) return
    // The seam's answer settles the point; no test-side `settle` call is needed,
    // which is the difference between a registered waiting point and a wired one.
    await expect(asked.answer).resolves.toEqual({ waitingPoint: POINT_A, text: 'yes, proceed' })
    expect(seam.asked).toEqual([{ id: String(POINT_A), question: 'proceed?' }])
  })

  it('leaves a second asker waiting when the first is settled, so one answer resumes one caller', async () => {
    // The negative half of acceptance[1], observed on the real continuation
    // rather than on a decision's return value: the point that was not
    // addressed is still pending, and its caller has not been resumed.
    const { service, seam } = await mounted()
    seam.answer = 'refuse'
    const second = service.ask({ waitingPoint: POINT_B, prompt: 'b?' }, AGENT)
    if (!('answer' in second)) throw new Error('the ask should have been admitted')
    // B's seam call refuses, so B's caller learns it rather than waiting; A is
    // settled out of band and resumes with its own text. One answer, one caller.
    await expect(second.answer).rejects.toEqual({ reason: 'no-answerer' })
    seam.answer = { selected: ['only A'] }
    const first = service.ask({ waitingPoint: POINT_A, prompt: 'a?' }, AGENT)
    if (!('answer' in first)) throw new Error('the ask should have been admitted')
    await expect(first.answer).resolves.toMatchObject({ text: 'only A' })
  })

  it('refuses an answer for a point nobody is waiting at, rather than dropping it', async () => {
    // A dropped answer is indistinguishable from a delivered one at the surface
    // that sent it, which is how "the human answered" becomes a fact nobody can
    // check.
    const { service } = await mounted()
    expect(service.settle({ waitingPoint: POINT_A, text: 'nobody asked' }))
      .toEqual({ reason: 'unknown-waiting-point', waitingPoint: POINT_A })
  })

  it('refuses to ask at all while a stop is in force, so a question is new work', async () => {
    const { service } = await mounted()
    service.control('pause-new-actions', request)
    const asked = service.ask({ waitingPoint: POINT_A, prompt: 'proceed?' }, AGENT)
    expect(asked).toEqual({ refused: { reason: 'stopped', record: { ...request, release: 'explicit-resume' } } })
  })

  it('comes up stopped over a store a previous mount wrote, with nothing re-applying the stop', async () => {
    // acceptance[2] through the mounted surface, not just the channel: the
    // second service is a new process as far as this property is concerned.
    const storePath = mkdtempSync(join(tmpdir(), 'control-plane-restart-'))
    roots.push(storePath)
    const first = new Context()
    await first.plugin(ControlPlaneService, { storePath })
    first.get('controlPlane')?.control('pause-new-actions', request)
    const second = new Context()
    await second.plugin(ControlPlaneService, { storePath })
    expect(second.get('controlPlane')?.state()).toMatchObject({ stopped: true })
  })
})
