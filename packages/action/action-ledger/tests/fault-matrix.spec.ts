/**
 * P4-12 Fault: the crash campaign, and the two failures a retry cannot see.
 *
 * acceptance[0] asks for zero duplicate external effects across 10,000 random
 * crashes. The campaign here drives a fake external service that RECORDS every
 * request it receives, so a duplicate is counted at the service rather than
 * inferred from the ledger — asking the ledger whether it prevented a
 * duplicate is asking the defendant.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import { openLedgerStore } from '../src/store.ts'
import type { LedgerEpoch, ReceiptDigest } from '../src/types.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'action-ledger-fault-'))
  roots.push(dir)
  return dir
}

const SCOPE = brandString<PrincipalId>('agent-1')
const ARGS = brandString<ArgumentsHash>('sha256-aaa')
const epoch = (n: number) => n as LedgerEpoch

/** Where a crash lands, relative to the one request that leaves the harness. */
type CrashPoint = 'none' | 'after-reserve' | 'after-send' | 'after-receipt'

class SimulatedCrash extends Error {}

/**
 * A fake external service that remembers what it was asked to do.
 *
 * `commits` is the only number acceptance[0] is about: the ledger's own view
 * of events cannot answer whether the outside world acted twice.
 */
class FakeExternalService {
  readonly commits: string[] = []

  send(key: string): ReceiptDigest {
    this.commits.push(key)
    return brandString<ReceiptDigest>(`receipt-${String(this.commits.length)}`)
  }
}

/**
 * One delivery attempt, crashing where told.
 *
 * The ORDER is the arrangement under test and mirrors the store's contract:
 * reserve durably, send, then record. A crash between any two steps leaves the
 * ledger in a state the next attempt reads.
 * @param dir - the ledger directory, shared across attempts as a restart is.
 * @param service - the fake external service.
 * @param key - the idempotency key for this effect.
 * @param crashAt - where this attempt dies.
 */
function attempt(dir: string, service: FakeExternalService, key: IdempotencyKey, crashAt: CrashPoint): void {
  const ledger = openLedgerStore(dir)
  const decision = ledger.reserve({ scope: SCOPE, key, argumentsHash: ARGS, epoch: epoch(1) })
  if (decision.action !== 'reserved') return
  if (crashAt === 'after-reserve') throw new SimulatedCrash()

  ledger.markSent(SCOPE, key, epoch(1))
  const receipt = service.send(key)
  if (crashAt === 'after-send') throw new SimulatedCrash()

  ledger.confirm(SCOPE, key, epoch(1), receipt)
  if (crashAt === 'after-receipt') throw new SimulatedCrash()
}

describe('P4-12 acceptance[0]: a crash campaign produces zero duplicate external effects', () => {
  it('commits each effect exactly once across 10,000 random crashes, counted at the SERVICE', () => {
    // The count comes from the fake service, not from the ledger. A ledger
    // asked whether it prevented duplicates is the defendant answering; the
    // service is where a duplicate would actually land.
    //
    // Deterministic rather than seeded from a clock: a campaign that cannot be
    // re-run identically turns a failure into a story about which run it was.
    const points: CrashPoint[] = ['none', 'after-reserve', 'after-send', 'after-receipt']
    const service = new FakeExternalService()
    // One ledger directory per key, reused across that key's attempts, which
    // is what a restart looks like: the process is new, the durable state is
    // not. A fresh directory per attempt would give every retry an empty
    // ledger, and the campaign would measure nothing.
    const home = new Map<string, string>()
    let random = 12_345
    for (let index = 0; index < 10_000; index += 1) {
      random = (random * 1_103_515_245 + 12_345) % 2_147_483_648
      const key = brandString<IdempotencyKey>(`effect-${String(index % 250)}`)
      const dir = home.get(key) ?? directory()
      home.set(key, dir)
      try {
        attempt(dir, service, key, points[random % points.length]!)
      } catch (error) {
        if (!(error instanceof SimulatedCrash)) throw error
      }
    }
    const counts = new Map<string, number>()
    for (const key of service.commits) counts.set(key, (counts.get(key) ?? 0) + 1)
    expect([...counts.values()].filter(count => count > 1)).toEqual([])
    // Without this the case passes when nothing was ever sent.
    expect(service.commits.length).toBe(250)
  }, 120_000)

  it('still commits the effect at least once when a crash lands before the send', () => {
    // The control the campaign needs: a ledger that refused everything would
    // report zero duplicates and zero effects. `prepared` must stay retryable.
    const dir = directory()
    const service = new FakeExternalService()
    const key = brandString<IdempotencyKey>('effect-retryable')
    expect(() => { attempt(dir, service, key, 'after-reserve') }).toThrow(SimulatedCrash)
    expect(service.commits).toEqual([])
    attempt(dir, service, key, 'none')
    expect(service.commits).toEqual([key])
  })
})

describe('P4-12 validation: a provider that timed out AFTER committing', () => {
  it('leaves the effect committed once when the ledger is told the outcome is unknown', () => {
    // The case the whole `ambiguous` state exists for, and the one a retry
    // cannot resolve: the service DID commit and the caller never learned it.
    // Retrying would send a second time; the ledger must refuse and hand the
    // decision to reconciliation instead.
    const dir = directory()
    const service = new FakeExternalService()
    const key = brandString<IdempotencyKey>('effect-timeout')
    const ledger = openLedgerStore(dir)
    ledger.reserve({ scope: SCOPE, key, argumentsHash: ARGS, epoch: epoch(1) })
    ledger.markSent(SCOPE, key, epoch(1))
    service.send(key)
    ledger.markAmbiguous(SCOPE, key, epoch(1))

    expect(openLedgerStore(dir).reserve({ scope: SCOPE, key, argumentsHash: ARGS, epoch: epoch(1) }))
      .toEqual({ action: 'refused', reason: 'ambiguous-needs-reconciliation' })
    expect(service.commits).toEqual([key])
  })
})

describe('P4-12 validation: a batch action is ledgered item by item', () => {
  it('reserves each item separately, so one item failing does not resend the others', () => {
    // A batch that shared one key would make the whole batch a single
    // reservation: retrying after a partial failure would either resend
    // everything or nothing.
    const dir = directory()
    const service = new FakeExternalService()
    const keys = ['batch-a', 'batch-b', 'batch-c'].map(id => brandString<IdempotencyKey>(id))
    for (const key of keys.slice(0, 2)) attempt(dir, service, key, 'none')
    expect(() => { attempt(dir, service, keys[2]!, 'after-send') }).toThrow(SimulatedCrash)
    // The retry sends only the item that never confirmed.
    for (const key of keys) {
      try {
        attempt(dir, service, key, 'none')
      } catch (error) {
        if (!(error instanceof SimulatedCrash)) throw error
      }
    }
    expect(service.commits).toEqual(['batch-a', 'batch-b', 'batch-c'])
  })
})
