/**
 * B-726 (P4-12 acceptance[1]): a retry under a new call id presents a new key,
 * and the ledger still recognises it as the same action. A crash leaves an
 * effect `sent` or `ambiguous` under one key; another key's reservation for the
 * same tool and arguments in that scope must not send it again before the host
 * user settles the first.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ArgumentsHash, CapabilityRef, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { PrincipalId, RunId } from '@deepseek-ai/dsh-principal'
import { sameActionBlockers } from '../src/index.ts'
import { openLedgerStore } from '../src/store.ts'
import type { LedgerEntry, LedgerEpoch, LedgerGeneration, ReceiptDigest, ReserveRequest } from '../src/types.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'action-ledger-same-'))
  roots.push(dir)
  return dir
}

const SCOPE = brandString<PrincipalId>('host-user')
const FIRST = brandString<IdempotencyKey>('call-1-key')
const RETRY = brandString<IdempotencyKey>('call-2-key')
const ARGS = brandString<ArgumentsHash>('sha256-send-mail')
const SEND = brandString<CapabilityRef>('send_mail')
const RUN = brandString<RunId>('run-1')
const OTHER_RUN = brandString<RunId>('run-2')
const epoch = (n: number) => n as LedgerEpoch
const request = (over: Partial<ReserveRequest> = {}): ReserveRequest =>
  ({ scope: SCOPE, key: FIRST, argumentsHash: ARGS, epoch: epoch(1), capability: SEND, leaseRun: RUN, ...over })

/** Leave the first call's effect `sent` at generation 1 of {@link RUN}, as a crash after the send does. */
function sentFirst(dir: string): void {
  const ledger = openLedgerStore(dir)
  expect(ledger.reserve(request()).action).toBe('reserved')
  ledger.markSent(SCOPE, FIRST, epoch(1))
}

describe('B-726: a retry under a new key is the same action while the first is unsettled', () => {
  it('refuses the retry while another key\'s entry for the same tool and arguments is ambiguous, whatever run it came from', () => {
    const dir = directory()
    sentFirst(dir)
    openLedgerStore(dir).markAmbiguous(SCOPE, FIRST, epoch(1))
    const ledger = openLedgerStore(dir)
    expect(ledger.reserve(request({ key: RETRY, epoch: epoch(0), leaseRun: OTHER_RUN })))
      .toEqual({ action: 'refused', reason: 'ambiguous-needs-reconciliation' })
    expect(ledger.entry(SCOPE, RETRY)).toBeUndefined()
  })

  it('refuses a newer generation of the same run and moves the older generation\'s SENT entry to ambiguous in the same reservation', () => {
    const dir = directory()
    sentFirst(dir)
    const ledger = openLedgerStore(dir)
    expect(ledger.reserve(request({ key: RETRY, epoch: epoch(2) })))
      .toEqual({ action: 'refused', reason: 'ambiguous-needs-reconciliation' })
    expect(ledger.entry(SCOPE, FIRST)).toMatchObject({ state: 'ambiguous', epoch: 1, capability: SEND, leaseRun: RUN })
    expect(ledger.listAmbiguous(SCOPE).map(entry => entry.key)).toEqual([FIRST])
    expect(ledger.entry(SCOPE, RETRY)).toBeUndefined()
  })

  it('does not stop a SENT entry of this generation, of another run, or under an unfenced request: it may still be in flight', () => {
    const dir = directory()
    sentFirst(dir)
    const ledger = openLedgerStore(dir)
    expect(ledger.reserve(request({ key: RETRY })).action).toBe('reserved')
    expect(ledger.reserve(request({ key: brandString<IdempotencyKey>('other-run'), epoch: epoch(5), leaseRun: OTHER_RUN })).action).toBe('reserved')
    expect(ledger.reserve(request({ key: brandString<IdempotencyKey>('unfenced'), epoch: 'unfenced' as LedgerGeneration })).action).toBe('reserved')
    expect(ledger.entry(SCOPE, FIRST)?.state).toBe('sent')
  })

  it('does not stop a reservation for a settled entry, other arguments or another tool', () => {
    const dir = directory()
    sentFirst(dir)
    const ledger = openLedgerStore(dir)
    ledger.markAmbiguous(SCOPE, FIRST, epoch(1))
    expect(ledger.reserve(request({ key: RETRY, argumentsHash: brandString<ArgumentsHash>('sha256-other') })).action).toBe('reserved')
    expect(ledger.reserve(request({ key: brandString<IdempotencyKey>('other-tool'), capability: brandString<CapabilityRef>('read_mail') })).action).toBe('reserved')
    ledger.confirm(SCOPE, FIRST, epoch(1), brandString<ReceiptDigest>('resolved'), { outcome: 'confirmed', resolvedBy: SCOPE, resolvedAt: 1 })
    expect(ledger.reserve(request({ key: brandString<IdempotencyKey>('repeat-on-purpose') })).action).toBe('reserved')
  })

  it('matches a request that names no capability by its key alone', () => {
    const dir = directory()
    sentFirst(dir)
    openLedgerStore(dir).markAmbiguous(SCOPE, FIRST, epoch(1))
    const unnamed: ReserveRequest = { scope: SCOPE, key: RETRY, argumentsHash: ARGS, epoch: epoch(1), leaseRun: RUN }
    expect(openLedgerStore(dir).reserve(unnamed).action).toBe('reserved')
  })
})

describe('B-726: a resumed session sends its interrupted calls\' effects to reconciliation', () => {
  it('moves only SENT entries to ambiguous, in one call, and returns what it moved', () => {
    const dir = directory()
    sentFirst(dir)
    const ledger = openLedgerStore(dir)
    const settled = brandString<IdempotencyKey>('settled')
    ledger.reserve(request({ key: settled }))
    ledger.markSent(SCOPE, settled, epoch(1))
    ledger.confirm(SCOPE, settled, epoch(1), brandString<ReceiptDigest>('receipt'))
    const moved = ledger.markInterrupted([
      { scope: SCOPE, key: FIRST },
      { scope: SCOPE, key: settled },
      { scope: SCOPE, key: brandString<IdempotencyKey>('never-reserved') },
    ])
    expect(moved.map(entry => [entry.key, entry.state, entry.epoch])).toEqual([[FIRST, 'ambiguous', 1]])
    expect(ledger.entry(SCOPE, settled)?.state).toBe('confirmed')
    expect(ledger.reserve(request({ key: RETRY, epoch: epoch(0), leaseRun: OTHER_RUN })))
      .toEqual({ action: 'refused', reason: 'ambiguous-needs-reconciliation' })
  })

  it('moves all of a batch or none of it: a key the store cannot bind rolls the earlier moves back', () => {
    const dir = directory()
    sentFirst(dir)
    const ledger = openLedgerStore(dir)
    expect(() => ledger.markInterrupted([
      { scope: SCOPE, key: FIRST },
      { scope: SCOPE, key: { not: 'a key' } as unknown as string },
    ])).toThrow()
    expect(ledger.entry(SCOPE, FIRST)?.state).toBe('sent')
  })
})

describe('B-726: sameActionBlockers decides from the entries it is given', () => {
  const entry = (over: Partial<LedgerEntry>): LedgerEntry =>
    ({ scope: SCOPE, key: FIRST, argumentsHash: ARGS, state: 'ambiguous', epoch: epoch(1), capability: SEND, leaseRun: RUN, ...over })
  const retry = request({ key: RETRY, epoch: epoch(2) })

  it('returns nothing for a request that names no capability', () => {
    const unnamed: ReserveRequest = { scope: SCOPE, key: RETRY, argumentsHash: ARGS, epoch: epoch(2) }
    expect(sameActionBlockers(unnamed, [entry({})])).toEqual([])
  })

  it('keeps only another key\'s unsettled entry for the same scope, tool and arguments', () => {
    const blocking = [entry({}), entry({ key: brandString<IdempotencyKey>('older-sent'), state: 'sent' })]
    const passing = [
      entry({ key: RETRY }),
      entry({ key: brandString<IdempotencyKey>('other-scope'), scope: brandString<PrincipalId>('someone-else') }),
      entry({ key: brandString<IdempotencyKey>('other-tool'), capability: brandString<CapabilityRef>('read_mail') }),
      entry({ key: brandString<IdempotencyKey>('other-args'), argumentsHash: brandString<ArgumentsHash>('sha256-other') }),
      entry({ key: brandString<IdempotencyKey>('settled'), state: 'confirmed' }),
      entry({ key: brandString<IdempotencyKey>('same-generation'), state: 'sent', epoch: epoch(2) }),
      entry({ key: brandString<IdempotencyKey>('other-run'), state: 'sent', leaseRun: OTHER_RUN }),
      entry({ key: brandString<IdempotencyKey>('unfenced-holder'), state: 'sent', epoch: 'unfenced' }),
    ]
    expect(sameActionBlockers(retry, [...blocking, ...passing])).toEqual(blocking)
    const { leaseRun: _run, ...runless } = retry
    void _run
    expect(sameActionBlockers({ ...runless, epoch: 'unfenced' }, blocking)).toEqual([blocking[0]])
  })
})

describe('B-726: the ledger file records the capability and run, so an older file is refused', () => {
  it('refuses a version 2 file with the version message rather than a SQLite error', () => {
    const dir = directory()
    const db = new DatabaseSync(join(dir, 'action-ledger.sqlite'))
    db.exec('CREATE TABLE schema_version (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL)')
    db.exec('INSERT INTO schema_version (singleton, version) VALUES (1, 2)')
    db.exec('CREATE TABLE ledger (scope TEXT NOT NULL, key TEXT NOT NULL, arguments_hash TEXT NOT NULL, state TEXT NOT NULL, epoch INTEGER, receipt_digest TEXT, PRIMARY KEY (scope, key))')
    db.close()
    expect(() => openLedgerStore(dir)).toThrow(/is schema version 2, not 3; delete it to start a new ledger/u)
  })
})
