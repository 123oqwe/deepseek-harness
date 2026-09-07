/**
 * P4-07 Provider: the lease outlives its holder, and two PROCESSES cannot both
 * hold one item.
 *
 * The in-memory store this replaces made both of those unobservable. Its
 * leases lived in a `Map` created per engine instance, so "another host cannot
 * take this item" held only between two runs inside one process — and the case
 * asserting it ran in one process, which is why it passed while proving
 * nothing. Every case here either crosses a process boundary or crosses a
 * restart.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease'
import { openLeaseStore } from '../src/index.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lease-sqlite-'))
  roots.push(dir)
  return dir
}

const ITEM = brandString<WorkItemId>('run-1')
const A = brandString<WorkerId>('host-a')
const B = brandString<WorkerId>('host-b')

describe('P4-07 must[0]: one item, one holder, across PROCESSES', () => {
  it('gives the item to exactly one of two processes racing for it', async () => {
    // The property the Map could not have: two hosts are two processes, and
    // SQLite's BEGIN IMMEDIATE is what serializes them. Both children start
    // together on a readiness handshake rather than a sleep, so the case
    // observes contention instead of scheduling luck.
    const dir = directory()
    const go = join(dir, 'go')
    const child = (label: string) => new Promise<string>((resolve) => {
      const proc = spawn(process.execPath, ['--import', 'tsx', '-e', [
        "const { existsSync, writeFileSync } = await import('node:fs')",
        `const { openLeaseStore } = await import(${JSON.stringify(join(process.cwd(), 'packages/run/lease-sqlite/src/index.ts'))})`,
        `const store = openLeaseStore(${JSON.stringify(dir)})`,
        `writeFileSync(${JSON.stringify(join(dir, 'ready-'))} + ${JSON.stringify(label)}, '')`,
        `while (!existsSync(${JSON.stringify(go)})) { /* spin to the barrier */ }`,
        `const result = store.acquire('run-1', ${JSON.stringify(label)}, Date.now(), 30000)`,
        `console.log(${JSON.stringify(label)} + ':' + (result.acquired ? 'acquired' : result.reason))`,
      ].join('\n')], { stdio: ['ignore', 'pipe', 'inherit'] })
      let out = ''
      proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
      proc.on('close', () => { resolve(out.trim().split(':')[1] ?? '(none)') })
    })
    const both = Promise.all([child('a'), child('b')])
    while (!existsSync(join(dir, 'ready-a')) || !existsSync(join(dir, 'ready-b'))) {
      await new Promise(resolve => setImmediate(resolve))
    }
    writeFileSync(go, '')
    const results = await both
    expect(results.filter(r => r === 'acquired')).toHaveLength(1)
    expect(results.filter(r => r === 'held-by-another')).toHaveLength(1)
  }, 30_000)

  it('keeps the lease after the holder is gone, so a scheduler can still see who owns it', () => {
    // A Map dies with its process; an orphaned lease is exactly what `must[2]`
    // needs to reclaim, and what `acceptance[0]`'s recovered worker must find
    // taken.
    const dir = directory()
    openLeaseStore(dir).acquire(ITEM, A, 1_000, 30_000)
    expect(openLeaseStore(dir).get(ITEM)).toMatchObject({ holder: A, epoch: 0 })
  })
})

describe('P4-07 must[2]: an expired lease is reclaimable, and the new epoch is higher', () => {
  it('reclaims an expired item and issues an epoch above the dead holder\'s', () => {
    // The epoch must rise even though the previous lease row is replaced:
    // reissuing 0 would let the dead holder's token pass `checkFencing` when it
    // woke, which is the whole failure the epoch exists to prevent.
    const dir = directory()
    const store = openLeaseStore(dir)
    const first = store.acquire(ITEM, A, 1_000, 1_000)
    expect(first).toMatchObject({ acquired: true })
    expect(store.reclaimable(5_000)).toEqual([ITEM])
    const second = store.acquire(ITEM, B, 5_000, 30_000)
    if (!second.acquired) throw new Error('the expired item must be reclaimable')
    expect(second.token.epoch).toBe(1)
  })

  it('refuses to renew an already-expired lease, so a paused holder cannot resurrect its authority', () => {
    const dir = directory()
    const store = openLeaseStore(dir)
    const taken = store.acquire(ITEM, A, 1_000, 1_000)
    if (!taken.acquired) throw new Error('unreachable')
    expect(store.renew(taken.token, 5_000, 30_000)).toMatchObject({ renewed: false, reason: 'already-expired' })
  })

  it('renews a live lease WITHOUT issuing a new epoch, because the holder is unchanged', () => {
    const dir = directory()
    const store = openLeaseStore(dir)
    const taken = store.acquire(ITEM, A, 1_000, 30_000)
    if (!taken.acquired) throw new Error('unreachable')
    expect(store.renew(taken.token, 2_000, 30_000)).toMatchObject({ renewed: true, lease: { epoch: 0, expiresAtMs: 32_000 } })
  })
})

describe('P4-07 acceptance[2]: an unavailable store stops work in both directions', () => {
  it('refuses to acquire, and reports nothing reclaimable, while unavailable', () => {
    // Stop-work, not best-effort: a store that cannot answer cannot say
    // whether another host owns this item, and a scheduler asking "what can I
    // pick up" during an outage must find nothing.
    const dir = directory()
    const store = openLeaseStore(dir)
    store.acquire(ITEM, A, 1_000, 1)
    store.setAvailable(false)
    expect(store.acquire(brandString<WorkItemId>('run-2'), B, 2_000, 30_000)).toMatchObject({ acquired: false, reason: 'store-unavailable' })
    expect(store.reclaimable(9_000)).toEqual([])
  })

  it('resumes exactly where it left off once the store is back', () => {
    // The control: without it, a store that refused forever would satisfy the
    // case above.
    const dir = directory()
    const store = openLeaseStore(dir)
    store.setAvailable(false)
    store.setAvailable(true)
    expect(store.acquire(ITEM, A, 1_000, 30_000)).toMatchObject({ acquired: true })
  })
})
