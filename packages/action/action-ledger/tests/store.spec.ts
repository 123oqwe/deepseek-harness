/**
 * P4-12 Provider: the reservation survives the crash it exists for.
 *
 * The Contract stage's decision is a pure function; this is what makes it
 * durable. Every case here is about a process that is gone — the one the
 * in-memory decision cannot help.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import { openLedgerStore } from '../src/store.ts'
import type { LedgerStore } from '../src/store.ts'
import type { LedgerEpoch, LedgerGeneration, ReceiptDigest } from '../src/types.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'action-ledger-'))
  roots.push(dir)
  return dir
}

const store = (): LedgerStore => openLedgerStore(directory())
const SCOPE = brandString<PrincipalId>('agent-1')
const OTHER_SCOPE = brandString<PrincipalId>('agent-2')
const KEY = brandString<IdempotencyKey>('effect-1')
const ARGS = brandString<ArgumentsHash>('sha256-aaa')
const epoch = (n: number) => n as LedgerEpoch
const request = (over: Partial<{ scope: PrincipalId; key: IdempotencyKey; argumentsHash: ArgumentsHash; epoch: LedgerGeneration }> = {}) =>
  ({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1), ...over })

describe('P4-12 must[2]: the reservation is durable BEFORE the request is sent', () => {
  it('reports a SENT key as a duplicate after a restart, which is the crash this epic exists for', () => {
    // The whole point: the process that sent the request is gone, and the
    // replacement must not send it again. An in-memory decision cannot know.
    const dir = directory()
    const first = openLedgerStore(dir)
    first.reserve(request())
    first.markSent(SCOPE, KEY, epoch(1))
    expect(openLedgerStore(dir).reserve(request()).action).toBe('duplicate')
  })

  it('still reserves a PREPARED key after a restart at the NEXT generation, because nothing was sent', () => {
    // The control that keeps the case above from being "restart refuses
    // everything". A crash before the send must leave the work doable.
    //
    // The restart presents a HIGHER generation, which is what a restart
    // actually is once a lease is involved: the Run Service issues the
    // replacement a new epoch, and that epoch is what proves the crashed holder
    // is out. The case presented the SAME generation until BLOCKED-221, so the
    // behavior it froze was a peer taking a live holder's reservation rather
    // than a successor taking a dead one's.
    const dir = directory()
    openLedgerStore(dir).reserve(request())
    expect(openLedgerStore(dir).reserve(request({ epoch: epoch(2) })).action).toBe('reserved')
  })

  it('still reserves a PREPARED key after an UNFENCED restart, where no generation can prove the holder gone', () => {
    // The second half of the same control, for a profile that mounts no Run
    // Service and so has no lease to take a generation from. Refusing here
    // would strand the key forever and lose at-least-once, so the entry is
    // re-taken; the decision says `fenced: false` rather than implying the
    // exclusivity that only generations can give.
    const dir = directory()
    openLedgerStore(dir).reserve(request({ epoch: 'unfenced' }))
    expect(openLedgerStore(dir).reserve(request({ epoch: 'unfenced' })))
      .toMatchObject({ action: 'reserved', fenced: false })
  })

  it('lets an unfenced holder record the send it made, so the degraded path is usable end to end', () => {
    // The absent generation is SQL NULL, and `NULL = NULL` is false — a
    // transition matching with `=` would refuse every write by the caller just
    // told it holds the reservation, making an unfenced reservation a
    // reservation nobody can use.
    const dir = directory()
    const ledger = openLedgerStore(dir)
    ledger.reserve(request({ epoch: 'unfenced' }))
    expect(() => { ledger.markSent(SCOPE, KEY, 'unfenced') }).not.toThrow()
    expect(openLedgerStore(dir).reserve(request({ epoch: 'unfenced' })).action).toBe('duplicate')
  })

  it('keeps the receipt digest across a restart, so a confirmed effect stays evidenced', () => {
    const dir = directory()
    const first = openLedgerStore(dir)
    first.reserve(request())
    first.markSent(SCOPE, KEY, epoch(1))
    first.confirm(SCOPE, KEY, epoch(1), brandString<ReceiptDigest>('sha256-receipt'))
    expect(openLedgerStore(dir).entry(SCOPE, KEY)).toMatchObject({ state: 'confirmed', receiptDigest: 'sha256-receipt' })
  })
})

describe('P4-12 must[2]: two workers cannot both hold one reservation', () => {
  /**
   * Two processes reserving one key at the same instant, started together.
   *
   * The property a single process cannot demonstrate. Deciding outside the
   * transaction lets both read "no entry", both decide `reserved`, and both
   * send — the duplicate the ledger exists to prevent, produced by the ledger
   * itself.
   *
   * The children START TOGETHER on a file barrier rather than merely being
   * spawned together. Measured why: without it, the mutation that moves the
   * decision outside the transaction still passed, because the two processes
   * serialised by luck. A concurrency case that depends on timing tests nothing
   * it claims.
   *
   * The barrier is a READINESS HANDSHAKE, not a sleep. The first version waited
   * 1500 ms and hoped both children had arrived; the delegate saw it fail once
   * on a cold-cache first run in a clean worktree and pass nine times after,
   * which is what a timing assumption looks like from outside. Each child
   * announces itself and the parent releases the barrier only once both have.
   *
   * stderr is captured into the assertion message: a case that fails once in
   * ten and discards the child's own output leaves nothing to diagnose.
   * @param generation - the lease generation both children present, or `'unfenced'` for neither holding one.
   * @returns each child's decision, plus their stderr as one assertion message.
   */
  async function race(generation: number | 'unfenced'): Promise<{ decisions: string[]; detail: string }> {
    const dir = directory()
    const go = join(dir, 'go')
    const child = (label: string) => new Promise<{ action: string; stderr: string }>((resolve) => {
      const proc = spawn(process.execPath, ['--import', 'tsx', '-e', [
        "const { existsSync, writeFileSync } = await import('node:fs')",
        `const { openLedgerStore } = await import(${JSON.stringify(join(process.cwd(), 'packages/action/action-ledger/src/store.ts'))})`,
        `const store = openLedgerStore(${JSON.stringify(dir)})`,
        `writeFileSync(${JSON.stringify(join(dir, 'ready-'))} + ${JSON.stringify(label)}, '')`,
        `while (!existsSync(${JSON.stringify(go)})) { /* spin to the barrier */ }`,
        `const decision = store.reserve({ scope: 'agent-1', key: 'effect-1', argumentsHash: 'sha256-aaa', epoch: ${JSON.stringify(generation)} })`,
        // NO `markSent`. The child used to send when it won, which made the
        // LOSER's answer a function of the schedule: `duplicate` when the
        // winner's send landed before the loser's transaction began,
        // `held-at-same-epoch` when it did not. must[2] is about two workers
        // HOLDING one reservation, so the case stops at the reservation and the
        // answer stops depending on a race the store does not cover. The
        // send-then-`duplicate` path is measured in-process instead, where the
        // order is stated rather than hoped for.
        // The REASON, not just the action: which situation a refusal names is
        // the whole point of it, and a child printing only `refused` would let
        // `stale-epoch` or `ambiguous` pass for the peer refusal.
        `console.log(${JSON.stringify(label)} + ':' + (decision.action === 'refused' ? decision.reason : decision.action))`,
      ].join('\n')], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
      proc.stderr.on('data', (chunk: Buffer) => { err += chunk.toString() })
      proc.on('close', () => { resolve({ action: out.trim().split(':')[1] ?? '(no decision)', stderr: err.trim() }) })
    })
    const both = Promise.all([child('a'), child('b')])
    const ready = (label: string) => existsSync(join(dir, `ready-${label}`))
    while (!ready('a') || !ready('b')) await new Promise(resolve => setImmediate(resolve))
    writeFileSync(go, '')
    const results = await both
    return { decisions: results.map(r => r.action), detail: results.map(r => r.stderr).filter(Boolean).join('\n---\n') }
  }

  it('gives the reservation to ONE of two concurrent processes at the same generation, and refuses the other as a peer', async () => {
    // The loser is refused `held-at-same-epoch`, deterministically (BLOCKED-221).
    // The case asserted `duplicate`, which the loser can only receive if the
    // winner's send landed before the loser's transaction began — and measured
    // both ways at one SHA: run 34666554965 green, run 34667961832 red. What
    // the old assertion reported was the schedule; refusing a peer inside the
    // reservation's own transaction makes the answer a property of the ledger.
    const { decisions, detail } = await race(1)
    expect(decisions.filter(decision => decision === 'reserved'), detail).toHaveLength(1)
    expect(decisions.filter(decision => decision === 'held-at-same-epoch'), detail).toHaveLength(1)
  }, 30_000)

  it('admits BOTH unfenced processes, because without generations a peer and a restart are the same observation', async () => {
    // The honest control, and the reason `fenced` is on the decision at all.
    // With no generations the ledger cannot tell two live workers from one
    // worker restarting, so refusing either would strand keys that were never
    // sent; both hold the reservation and both may send. A profile that mounts
    // no Run Service gets at-least-once and NOT must[2], recorded here rather
    // than left for a reader to discover from a duplicate external effect.
    const { decisions, detail } = await race('unfenced')
    expect(decisions.filter(decision => decision === 'reserved'), detail).toHaveLength(2)
  }, 30_000)
})

describe('P4-12 must[3]: a fenced-out generation cannot write', () => {
  it('refuses a transition from an epoch the current holder has superseded', () => {
    const ledger = store()
    ledger.reserve(request({ epoch: epoch(5) }))
    expect(() => { ledger.markSent(SCOPE, KEY, epoch(1)) }).toThrow(/held by epoch 5/u)
  })

  it('lets the CURRENT holder write, so fencing refuses only what is behind', () => {
    const ledger = store()
    ledger.reserve(request({ epoch: epoch(5) }))
    expect(() => { ledger.markSent(SCOPE, KEY, epoch(5)) }).not.toThrow()
  })

  it('refuses a transition for a key that was never reserved, rather than creating one', () => {
    // A `sent` row with no reservation before it would be a record of an
    // effect nobody took responsibility for.
    expect(() => { store().markSent(SCOPE, KEY, epoch(1)) }).toThrow(/no reservation/u)
  })

  it('keeps the database off the handle, so nothing outside the store can run a statement', () => {
    // What encapsulation here actually is. A first draft asserted that a
    // handle "not produced by openLedgerStore" is refused, and the case failed:
    // a spread copy still works, because every method is a closure over the
    // same connection, so that refusal could never fire in this package. It
    // does fire in `dsh-message-bus`, whose `commitIntake(store, ...)` takes
    // the handle as a parameter — the guard is load-bearing there and was
    // decoration here. The real property here is that the connection is
    // reachable through no property at all.
    const ledger = store()
    expect(Object.values(ledger).every(value => typeof value === 'function')).toBe(true)
    expect(JSON.stringify(ledger)).toBe('{}')
  })
})

describe('P4-12 must[2]: the durable store keeps two principals apart (BLOCKED-142)', () => {
  it('keeps one key reserved by two principals as two rows, neither visible to the other', () => {
    const ledger = store()
    ledger.reserve(request())
    ledger.markSent(SCOPE, KEY, epoch(1))
    expect(ledger.reserve(request({ scope: OTHER_SCOPE })).action).toBe('reserved')
    expect(ledger.entry(OTHER_SCOPE, KEY)).toMatchObject({ state: 'prepared' })
    expect(ledger.entry(SCOPE, KEY)).toMatchObject({ state: 'sent' })
  })

  it('refuses a transition presented under the WRONG principal, so a key cannot be moved from outside its scope', () => {
    const ledger = store()
    ledger.reserve(request())
    expect(() => { ledger.markSent(OTHER_SCOPE, KEY, epoch(1)) }).toThrow(/no reservation/u)
  })
})
