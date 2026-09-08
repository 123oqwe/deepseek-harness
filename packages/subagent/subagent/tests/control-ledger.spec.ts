/**
 * The control ledger's durability (Epic P5-10 must[2]).
 *
 * **must[2] says the control record is durable, and an in-memory `Set` is not.**
 * `SubagentRuntime` held applied epochs in a map that lives as long as the
 * process: a redelivery inside one run was refused, and every redelivery after
 * a restart was admitted — which is precisely when a client that never saw its
 * acknowledgement retries.
 *
 * §12.26 ruled the ledger belongs to the manager and is rebuilt from a log
 * rather than kept in memory, and assumed control dispatch already lands in the
 * PARENT's session log. Measured on this tree, it does not: the manager emits
 * Cordis events and appends nothing to the parent. What IS durable is the
 * delivered message, which lands in the CHILD's inbox carrying `source.rpcId` —
 * and a child's session outlives its Agent. These cases pin that reading.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { openControlLedger } from '../src/control-ledger.ts'

const CHILD = SessionId('child-1')
const epochOf = (requestId: string): number => requestId.length

async function sessions() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return ctx
}

/** One delivered prompt, as `SubagentRuntime` records it in the child's inbox. */
function delivered(rpcId: string) {
  return createUserMessage({
    content: [{ type: 'text', text: 'do the thing' }],
    source: { kind: 'user', rpcId } as never,
  })
}

describe('P5-10 must[2]: the applied-epoch record is durable', () => {
  it('refuses a redelivery through a ledger that holds NOTHING in memory', async () => {
    // The restart, modelled the only way that matters: a ledger built fresh,
    // with no memory of the delivery, reading the log the dead process wrote.
    const ctx = await sessions()
    const session = ctx.sessions.create(CHILD)
    session.append('user/message', delivered('req-abc'), { surfaceOp: 'append' })

    const restored = openControlLedger(() => ctx.sessions.get(CHILD), epochOf)
    expect(restored.has(epochOf('req-abc'))).toBe(true)
  })

  it('admits an epoch the log does not carry, so the refusal is about the record and not about every message', async () => {
    // The control the refusal needs: without it a ledger answering `true` to
    // everything would satisfy the case above perfectly.
    const ctx = await sessions()
    const session = ctx.sessions.create(CHILD)
    session.append('user/message', delivered('req-abc'), { surfaceOp: 'append' })

    const restored = openControlLedger(() => ctx.sessions.get(CHILD), epochOf)
    expect(restored.has(epochOf('a-different-request'))).toBe(false)
  })

  it('answers false for a child that has no session at all, rather than throwing', async () => {
    // A child addressed before it exists is a caller mistake for the phase
    // check to report, not a crash in the idempotency read.
    const ctx = await sessions()
    expect(openControlLedger(() => ctx.sessions.get(CHILD), epochOf).has(1)).toBe(false)
  })

  it('reads the log at ASK time, so a delivery after the ledger was built still refuses', async () => {
    // A ledger that snapshotted its log at construction would answer about a
    // past session — and the window between building and asking is exactly
    // where a redelivery arrives.
    const ctx = await sessions()
    const session = ctx.sessions.create(CHILD)
    const ledger = openControlLedger(() => ctx.sessions.get(CHILD), epochOf)
    expect(ledger.has(epochOf('req-abc'))).toBe(false)

    session.append('user/message', delivered('req-abc'), { surfaceOp: 'append' })
    expect(ledger.has(epochOf('req-abc'))).toBe(true)
  })

  it('ignores a message carrying no rpcId, so ordinary user input is not an applied control epoch', async () => {
    // The child's inbox holds every kind of message. Treating one without a
    // request id as a control record would let ordinary input silently refuse
    // a later prompt whose epoch happened to collide.
    const ctx = await sessions()
    const session = ctx.sessions.create(CHILD)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'plain input' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    expect(openControlLedger(() => ctx.sessions.get(CHILD), epochOf).has(epochOf(''))).toBe(false)
  })
})
