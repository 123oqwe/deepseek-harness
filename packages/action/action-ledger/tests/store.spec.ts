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
import type { LedgerEpoch, ReceiptDigest } from '../src/types.ts'

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
const request = (over: Partial<{ scope: PrincipalId; key: IdempotencyKey; argumentsHash: ArgumentsHash; epoch: LedgerEpoch }> = {}) =>
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

  it('still reserves a PREPARED key after a restart, because nothing was sent', () => {
    // The control that keeps the case above from being "restart refuses
    // everything". A crash before the send must leave the work doable.
    const dir = directory()
    openLedgerStore(dir).reserve(request())
    expect(openLedgerStore(dir).reserve(request()).action).toBe('reserved')
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
  it('gives the reservation to ONE of two concurrent processes, and the other a duplicate', async () => {
    // The property a single process cannot demonstrate. Deciding outside the
    // transaction lets both read "no entry", both decide `reserved`, and both
    // send — the duplicate the ledger exists to prevent, produced by the
    // ledger itself.
    //
    // The two children START TOGETHER on a file barrier rather than merely
    // being spawned together. Measured why: without it, the mutation that
    // moves the decision outside the transaction still passed every case here,
    // because the two processes serialised by luck. A concurrency case that
    // depends on timing tests nothing it claims.
    const dir = directory()
    const go = join(dir, 'go')
    // A READINESS HANDSHAKE, not a sleep. The first version waited 1500 ms and
    // hoped both children had reached the barrier; the delegate saw it fail
    // once on a cold-cache first run in a clean worktree and pass nine times
    // after, which is what a timing assumption looks like from outside. Each
    // child announces itself, and the parent releases the barrier only once
    // both have — so the case tests contention rather than scheduling luck.
    //
    // stderr is captured into the assertion message: a case that fails once in
    // ten and discards the child's own output leaves nothing to diagnose.
    const child = (label: string) => new Promise<{ action: string; stderr: string }>((resolve) => {
      const proc = spawn(process.execPath, ['--import', 'tsx', '-e', [
        "const { existsSync, writeFileSync } = await import('node:fs')",
        `const { openLedgerStore } = await import(${JSON.stringify(join(process.cwd(), 'packages/action/action-ledger/src/store.ts'))})`,
        `const store = openLedgerStore(${JSON.stringify(dir)})`,
        `writeFileSync(${JSON.stringify(join(dir, 'ready-'))} + ${JSON.stringify(label)}, '')`,
        `while (!existsSync(${JSON.stringify(go)})) { /* spin to the barrier */ }`,
        "const decision = store.reserve({ scope: 'agent-1', key: 'effect-1', argumentsHash: 'sha256-aaa', epoch: 1 })",
        "if (decision.action === 'reserved') store.markSent('agent-1', 'effect-1', 1)",
        `console.log(${JSON.stringify(label)} + ':' + decision.action)`,
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
    const detail = results.map(r => r.stderr).filter(Boolean).join('\n---\n')
    expect(results.filter(r => r.action === 'reserved'), detail).toHaveLength(1)
    expect(results.filter(r => r.action === 'duplicate'), detail).toHaveLength(1)
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
