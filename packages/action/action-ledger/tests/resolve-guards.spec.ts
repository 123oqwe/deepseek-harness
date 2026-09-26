/**
 * B-515 v2 red-first (BLOCKED-311): a ledger transition that carries no host
 * resolution may not move an `ambiguous` or already-settled entry.
 *
 * Today `LedgerStore.confirm` without a resolution and `LedgerStore.markAmbiguous`
 * both transition with no state guard, so each silently moves an entry it should
 * refuse: a plain confirm can settle an `ambiguous` entry with no recorded
 * resolution, and `markAmbiguous` can drag a settled entry back to `ambiguous`.
 * These cases assert the guard B-515 v2 adds; they are red today and green after.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import { openLedgerStore } from '../src/store.ts'
import type { LedgerEpoch, LedgerResolution, ReceiptDigest } from '../src/types.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'action-ledger-guards-'))
  roots.push(dir)
  return dir
}

const SCOPE = brandString<PrincipalId>('agent-1')
const KEY = brandString<IdempotencyKey>('effect-1')
const ARGS = brandString<ArgumentsHash>('sha256-aaa')
const RECEIPT = brandString<ReceiptDigest>('receipt-1')
const epoch = (n: number) => n as LedgerEpoch
const resolution = (outcome: 'confirmed' | 'compensated'): LedgerResolution => ({ outcome, resolvedBy: SCOPE, resolvedAt: 1 })

describe('B-515 v2 (BLOCKED-311): a transition without a resolution may not move an ambiguous or settled entry', () => {
  it('a plain confirm (no resolution) on an ambiguous entry is refused', () => {
    const store = openLedgerStore(directory())
    store.reserve({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) })
    store.markSent(SCOPE, KEY, epoch(1))
    store.markAmbiguous(SCOPE, KEY, epoch(1))
    // Today confirm-without-resolution guards no state, so it silently settles the ambiguous entry.
    expect(() => { store.confirm(SCOPE, KEY, epoch(1), RECEIPT) }).toThrow()
  })

  it('markAmbiguous on an already-compensated (settled) entry is refused', () => {
    const store = openLedgerStore(directory())
    store.reserve({ scope: SCOPE, key: KEY, argumentsHash: ARGS, epoch: epoch(1) })
    store.markSent(SCOPE, KEY, epoch(1))
    store.markAmbiguous(SCOPE, KEY, epoch(1))
    store.markCompensated(SCOPE, KEY, epoch(1), resolution('compensated'))
    // Today markAmbiguous guards no state, so it silently drags the settled entry back to ambiguous.
    expect(() => { store.markAmbiguous(SCOPE, KEY, epoch(1)) }).toThrow()
  })
})
