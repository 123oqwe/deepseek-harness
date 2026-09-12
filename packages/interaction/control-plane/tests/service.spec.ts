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
 * The service is mounted in a bare Cordis context rather than a shipped
 * profile. The profile-level observation — a real human answer on the Web
 * question surface — needs a composition fixture and is deliberately separate:
 * it is the same property through one more layer, and this file is where the
 * property itself is pinned.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import type { WaitingPointId } from '@deepseek-ai/dsh-human-channel/types'
import ControlPlaneService from '../src/plugin.ts'
import type { ControlRequest } from '../src/channel.ts'

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
async function mounted(): Promise<ControlPlaneService> {
  const storePath = mkdtempSync(join(tmpdir(), 'control-plane-'))
  roots.push(storePath)
  const ctx = new Context()
  // Awaited: a Cordis fiber loads asynchronously, so reading the service off a
  // un-awaited `plugin()` finds nothing. Measured the hard way — the first
  // version of this helper threw "the service did not mount" for all five cases.
  await ctx.plugin(ControlPlaneService, { storePath })
  const service = ctx.get('controlPlane')
  if (service === undefined) throw new Error('the service did not mount')
  return service
}

describe('P2-12 acceptance[1]: the human answer reaches the point that asked (BLOCKED-215 closed)', () => {
  it('resumes the asker with the human text, which is the delivery P5-10 never had a path for', async () => {
    const service = await mounted()
    const asked = service.ask({ waitingPoint: POINT_A, prompt: 'proceed?' })
    expect('answer' in asked).toBe(true)
    if (!('answer' in asked)) return
    expect(service.settle({ waitingPoint: POINT_A, text: 'yes, proceed' })).toBeUndefined()
    await expect(asked.answer).resolves.toEqual({ waitingPoint: POINT_A, text: 'yes, proceed' })
  })

  it('leaves a second asker waiting when the first is settled, so one answer resumes one caller', async () => {
    // The negative half of acceptance[1], observed on the real continuation
    // rather than on a decision's return value: the point that was not
    // addressed is still pending, and its caller has not been resumed.
    const service = await mounted()
    const first = service.ask({ waitingPoint: POINT_A, prompt: 'a?' })
    const second = service.ask({ waitingPoint: POINT_B, prompt: 'b?' })
    if (!('answer' in first) || !('answer' in second)) throw new Error('both asks should have been admitted')
    service.settle({ waitingPoint: POINT_A, text: 'only A' })
    await expect(first.answer).resolves.toMatchObject({ text: 'only A' })
    expect(service.pending()).toEqual([POINT_B])
    const settled = await Promise.race([second.answer.then(() => 'resumed'), Promise.resolve('still waiting')])
    expect(settled).toBe('still waiting')
  })

  it('refuses an answer for a point nobody is waiting at, rather than dropping it', async () => {
    // A dropped answer is indistinguishable from a delivered one at the surface
    // that sent it, which is how "the human answered" becomes a fact nobody can
    // check.
    const service = await mounted()
    expect(service.settle({ waitingPoint: POINT_A, text: 'nobody asked' }))
      .toEqual({ reason: 'unknown-waiting-point', waitingPoint: POINT_A })
  })

  it('refuses to ask at all while a stop is in force, so a question is new work', async () => {
    const service = await mounted()
    service.control('pause-new-actions', request)
    const asked = service.ask({ waitingPoint: POINT_A, prompt: 'proceed?' })
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
