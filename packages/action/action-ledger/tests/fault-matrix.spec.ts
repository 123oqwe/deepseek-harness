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
import type { LedgerEpoch, LedgerGeneration, ReceiptDigest } from '../src/types.ts'

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
 * The GENERATION is a parameter because a restart is not anonymous: the Run
 * Service issues the replacement process a new lease epoch, and that epoch is
 * what proves the crashed holder is out. An attempt that presented the
 * previous holder's generation would be claiming to BE it (BLOCKED-221).
 * @param dir - the ledger directory, shared across attempts as a restart is.
 * @param service - the fake external service.
 * @param key - the idempotency key for this effect.
 * @param crashAt - where this attempt dies.
 * @param generation - the lease generation this attempt acts under, or `'unfenced'` when it holds no lease.
 */
function attempt(dir: string, service: FakeExternalService, key: IdempotencyKey, crashAt: CrashPoint, generation: LedgerGeneration): void {
  const ledger = openLedgerStore(dir)
  const decision = ledger.reserve({ scope: SCOPE, key, argumentsHash: ARGS, epoch: generation })
  if (decision.action !== 'reserved') return
  if (crashAt === 'after-reserve') throw new SimulatedCrash()

  ledger.markSent(SCOPE, key, generation)
  const receipt = service.send(key)
  if (crashAt === 'after-send') throw new SimulatedCrash()

  ledger.confirm(SCOPE, key, generation, receipt)
  if (crashAt === 'after-receipt') throw new SimulatedCrash()
}

const POINTS: readonly CrashPoint[] = ['none', 'after-reserve', 'after-send', 'after-receipt']

/**
 * The campaign's pseudo-random draw (BLOCKED-225).
 *
 * **`Math.imul`, and the HIGH bits.** Two separate defects lived in the one
 * line this replaces. `random * 1_103_515_245` was evaluated as a double, so
 * from the second iteration the product passed 2^53, the low bits were lost,
 * and `random % 4` came back 0 for 9956 of 10,000 draws -- a crash campaign
 * that almost never crashed. `Math.imul` keeps the multiply in 32 bits, which
 * is the arithmetic the generator is defined over.
 *
 * That alone is not enough, and the measurement says why. An LCG's LOW bits
 * have tiny periods: taking them gives the draw sequence `23012301…`, a
 * 4-cycle. Against 250 keys visited round-robin that is worse than it looks --
 * each key sees exactly TWO of the four crash points, forever -- while the
 * aggregate distribution comes out at a perfect 2500 each and satisfies any
 * count-based check. Hence the high bits, and hence the per-key coverage
 * assertion beside the distribution one: a histogram alone cannot tell a
 * uniform generator from a short cycle.
 * @param state - the generator's current 32-bit state.
 * @returns the next state and the crash point it draws.
 */
function draw(state: number): { state: number; point: CrashPoint } {
  const next = (Math.imul(state, 1_103_515_245) + 12_345) | 0
  return { state: next, point: POINTS[((next >>> 16) & 0x7fff) % POINTS.length]! }
}

describe('P4-12 acceptance[0]: a crash campaign produces zero duplicate external effects', () => {
  it('commits each effect exactly once across 10,000 random crashes, counted at the SERVICE', () => {
    // The count comes from the fake service, not from the ledger. A ledger
    // asked whether it prevented duplicates is the defendant answering; the
    // service is where a duplicate would actually land.
    //
    // Deterministic rather than seeded from a clock: a campaign that cannot be
    // re-run identically turns a failure into a story about which run it was.
    const service = new FakeExternalService()
    // One ledger directory per key, reused across that key's attempts, which
    // is what a restart looks like: the process is new, the durable state is
    // not. A fresh directory per attempt would give every retry an empty
    // ledger, and the campaign would measure nothing.
    const home = new Map<string, string>()
    // Each attempt on a key presents the NEXT generation, because a restart
    // takes a new lease epoch (BLOCKED-221). Repeating one generation would
    // make every retry its own peer and be refused, so the campaign would
    // measure a ledger that refuses rather than one that recovers.
    const generations = new Map<string, number>()
    const drawn = new Map<CrashPoint, number>(POINTS.map(point => [point, 0]))
    const pointsPerKey = new Map<string, Set<CrashPoint>>()
    let state = 12_345
    for (let index = 0; index < 10_000; index += 1) {
      const rolled = draw(state)
      state = rolled.state
      const key = brandString<IdempotencyKey>(`effect-${String(index % 250)}`)
      const dir = home.get(key) ?? directory()
      home.set(key, dir)
      const generation = (generations.get(key) ?? 0) + 1
      generations.set(key, generation)
      drawn.set(rolled.point, drawn.get(rolled.point)! + 1)
      ;(pointsPerKey.get(key) ?? pointsPerKey.set(key, new Set()).get(key)!).add(rolled.point)
      try {
        attempt(dir, service, key, rolled.point, epoch(generation))
      } catch (error) {
        if (!(error instanceof SimulatedCrash)) throw error
      }
    }
    // The campaign must CRASH to be a crash campaign, and the generator is
    // what decides whether it does. Lower bounds rather than equality: the
    // assertion is about a generator that reaches every point often, not about
    // one exact histogram, and an exact count is what a 4-cycle satisfies.
    for (const point of POINTS) expect(drawn.get(point), point).toBeGreaterThan(2_000)
    // Per KEY, not just in aggregate. A generator whose low bits cycle every
    // four draws produces a flawless aggregate histogram and still leaves each
    // key permanently blind to two of the four crash points.
    expect([...pointsPerKey.values()].filter(points => points.size < POINTS.length)).toEqual([])
    const counts = new Map<string, number>()
    for (const key of service.commits) counts.set(key, (counts.get(key) ?? 0) + 1)
    expect([...counts.values()].filter(count => count > 1)).toEqual([])
    // Without this the case passes when nothing was ever sent.
    expect(service.commits.length).toBe(250)
  }, 120_000)

  it('commits each effect exactly once across the same campaign run UNFENCED, which is where at-least-once stands alone', () => {
    // The control for the degraded path, and it says something the fenced
    // campaign cannot: crash-retry dedup does NOT come from fencing. Every
    // attempt here presents `'unfenced'`, so no generation ever proves a holder
    // gone, and the campaign still commits each effect exactly once -- because
    // what refuses a second send is the `sent` state, which a restart reads off
    // the disk.
    //
    // What unfenced gives up is CONCURRENT exclusivity, which this campaign is
    // the wrong instrument for: it is sequential, so there is never a live peer
    // to confuse with a restart. The two-process case in store.spec.ts is where
    // that loss is measured, and it shows both workers holding one reservation.
    const service = new FakeExternalService()
    const home = new Map<string, string>()
    let state = 12_345
    for (let index = 0; index < 10_000; index += 1) {
      const rolled = draw(state)
      state = rolled.state
      const key = brandString<IdempotencyKey>(`effect-${String(index % 250)}`)
      const dir = home.get(key) ?? directory()
      home.set(key, dir)
      try {
        attempt(dir, service, key, rolled.point, 'unfenced')
      } catch (error) {
        if (!(error instanceof SimulatedCrash)) throw error
      }
    }
    const counts = new Map<string, number>()
    for (const key of service.commits) counts.set(key, (counts.get(key) ?? 0) + 1)
    expect([...counts.values()].filter(count => count > 1)).toEqual([])
    expect(service.commits.length).toBe(250)
  }, 120_000)

  it('still commits the effect at least once when the NEXT generation retries a crash before the send', () => {
    // The control the campaign needs: a ledger that refused everything would
    // report zero duplicates and zero effects. `prepared` must stay retryable.
    //
    // The retry comes from the next generation, because that is what a restart
    // is. The case retried at the SAME generation until BLOCKED-221, which is
    // how it kept passing while the ledger handed a live peer the holder's
    // reservation: at one generation the two are the same request, so the
    // at-least-once control and the two-holder defect had identical evidence.
    const dir = directory()
    const service = new FakeExternalService()
    const key = brandString<IdempotencyKey>('effect-retryable')
    expect(() => { attempt(dir, service, key, 'after-reserve', epoch(1)) }).toThrow(SimulatedCrash)
    expect(service.commits).toEqual([])
    attempt(dir, service, key, 'none', epoch(2))
    expect(service.commits).toEqual([key])
  })

  it('still commits the effect at least once when an UNFENCED retry follows a crash before the send', () => {
    // The same control for a profile that mounts no Run Service and so has no
    // generation to advance. Nothing here can prove the crashed holder gone, so
    // the ledger re-takes the `prepared` entry and at-least-once survives; what
    // it gives up is exclusivity, which the `fenced: false` on the decision says
    // and the two-process case measures.
    const dir = directory()
    const service = new FakeExternalService()
    const key = brandString<IdempotencyKey>('effect-unfenced')
    expect(() => { attempt(dir, service, key, 'after-reserve', 'unfenced') }).toThrow(SimulatedCrash)
    expect(service.commits).toEqual([])
    attempt(dir, service, key, 'none', 'unfenced')
    expect(service.commits).toEqual([key])
  })

  it('does NOT commit again when the SAME generation retries a crash before the send, because a peer may hold it', () => {
    // The other side of the control, and the behavior that changed. At one
    // generation the ledger cannot tell a restart from a live peer, so it
    // refuses rather than authorize a second holder; progress comes from the
    // next generation, not from repeating this one.
    const dir = directory()
    const service = new FakeExternalService()
    const key = brandString<IdempotencyKey>('effect-same-generation')
    expect(() => { attempt(dir, service, key, 'after-reserve', epoch(1)) }).toThrow(SimulatedCrash)
    attempt(dir, service, key, 'none', epoch(1))
    expect(service.commits).toEqual([])
    attempt(dir, service, key, 'none', epoch(2))
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
    for (const key of keys.slice(0, 2)) attempt(dir, service, key, 'none', epoch(1))
    expect(() => { attempt(dir, service, keys[2]!, 'after-send', epoch(1)) }).toThrow(SimulatedCrash)
    // The retry sends only the item that never confirmed, and comes from the
    // next generation, as the process that performs it is the replacement.
    for (const key of keys) {
      try {
        attempt(dir, service, key, 'none', epoch(2))
      } catch (error) {
        if (!(error instanceof SimulatedCrash)) throw error
      }
    }
    expect(service.commits).toEqual(['batch-a', 'batch-b', 'batch-c'])
  })
})
