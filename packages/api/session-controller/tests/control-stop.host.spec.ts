/**
 * P2-12 acceptance[3] on the Web surface: the host's control state reaches a
 * surface, and reaches one that was not listening when it changed.
 *
 * **The clause is about surfaces AGREEING, and today they agree by being
 * silent.** Nothing user-facing carried the emergency stop at all — measured
 * across the API, client, ACP, SDK and web trees — so "all surfaces consistent"
 * was true the way a question nobody asks is answered. These cases are the
 * first half of making it true the other way: one surface that shows it.
 *
 * **Which program compiles this file.** Not the package's own
 * `tsconfig.host.json`, which carries no `include`: the ROOT
 * `tsconfig.host.json` claims every package's `tests` tree and already
 * references `./packages/interaction/control-plane`, so the import below needs
 * no reference of its own. The reference added to the package's host config is
 * for `src/`, which is a different program.
 *
 * **The third case is the one that earns the baseline.** A surface that
 * connects AFTER the stop was raised missed the only edge that said so. If the
 * state travelled in frames alone it would show "running" forever while every
 * already-connected surface showed "stopped" — which is precisely the
 * disagreement the clause forbids, produced by the mechanism meant to prevent
 * it. The positive control beside it matters for the same reason in reverse: a
 * baseline hardcoding `stopped: true` would pass the other two.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import ControlPlaneService from '@deepseek-ai/dsh-control-plane/plugin'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionControlController } from '../src/control.ts'
import type { SessionControlFrame } from '../src/types.ts'

const ownedContexts = new Set<Context>()
const roots: string[] = []
afterEach(async () => {
  await Promise.all([...ownedContexts].map(ctx => ctx.fiber.dispose()))
  ownedContexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** The operator's request, as a real surface would present one. */
const REQUEST = {
  requestedBy: brandString<PrincipalId>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
} as const

/**
 * A mounted controller over a REAL control plane, with its own store directory.
 * @returns the context and the controller under test.
 */
async function harness(): Promise<{ ctx: Context; control: SessionControlController }> {
  const ctx = new Context()
  ownedContexts.add(ctx)
  const root = await mkdtemp(join(tmpdir(), 'dsh-control-stop-'))
  roots.push(root)
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  await loop.create(SessionId('control-stop-session'))
  // The real service over a real store, not a stub: the state this surface
  // publishes has to be the one a worker's gate consults, and a stub would let
  // the two drift without any case noticing.
  await ctx.plugin(ControlPlaneService, { storePath: root })
  return { ctx, control: new SessionControlController(ctx) }
}

/**
 * Consume frames until the next control replacement.
 *
 * Other frame kinds interleave — the inbox projection publishes on its own
 * schedule — so a case that read exactly one frame would be asserting about
 * whichever arrived first.
 * @param iterator - the open control stream.
 * @returns the next control frame.
 */
async function nextControlFrame(
  iterator: AsyncIterator<SessionControlFrame>,
): Promise<Extract<SessionControlFrame, { type: 'control' }>> {
  for (;;) {
    const next = await iterator.next()
    if (next.done) throw new Error('stream ended before a control frame')
    if (next.value.type === 'control') return next.value
  }
}

describe('P2-12 acceptance[3]: the Web surface carries the host control state', () => {
  it('publishes a frame when a stop is raised while this surface is connected', async () => {
    const { ctx, control } = await harness()
    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    await iterator.next()

    ctx.controlPlane.control('pause-new-actions', REQUEST)

    const frame = await nextControlFrame(iterator)
    expect(frame.state.stopped).toBe(true)
    // The record, not only the flag: a surface showing "stopped" with nothing
    // to show about it sends an operator looking for the reason elsewhere.
    expect(frame.state).toMatchObject({
      stopped: true,
      record: { requestedBy: 'operator-1', reason: 'human-requested', requestedAtMs: 1_700_000_000_000 },
    })
    abort.abort()
  })

  it('reports NOT stopped before anything stopped it, so the frame above is about the stop', async () => {
    const { control } = await harness()
    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    const opened = await iterator.next()

    expect(opened.value).toMatchObject({ type: 'baseline', value: { control: { stopped: false } } })
    abort.abort()
  })

  it('publishes the release too, so a surface is not left showing a stop that was lifted', async () => {
    // The direction the other three do not cover. A surface that learned the
    // stop and never learns the resume is worse than one that never learned
    // either: it shows a halt the operator already lifted, and an operator
    // reading it goes looking for a stop that is not there.
    const { ctx, control } = await harness()
    ctx.controlPlane.control('pause-new-actions', REQUEST)

    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    const opened = await iterator.next()
    expect(opened.value).toMatchObject({ type: 'baseline', value: { control: { stopped: true } } })

    ctx.controlPlane.control('resume', REQUEST)

    const frame = await nextControlFrame(iterator)
    expect(frame.state).toEqual({ stopped: false })
    abort.abort()
  })

  it('carries the stop in the BASELINE of a surface that connected after it, which no frame could', async () => {
    const { ctx, control } = await harness()
    // The stop happens with nobody listening. A surface arriving now has no
    // frame to have missed and no way to ask for one.
    ctx.controlPlane.control('pause-new-actions', REQUEST)

    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    const opened = await iterator.next()

    expect(opened.value, 'a late surface must learn the stop from its baseline, or it disagrees with every earlier one')
      .toMatchObject({ type: 'baseline', value: { control: { stopped: true, record: { reason: 'human-requested' } } } })
    abort.abort()
  })
})
