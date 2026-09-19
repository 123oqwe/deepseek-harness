/**
 * P2-12 must[2] on the durable provider: no new lease while a stop is in force.
 *
 * **This is the provider a deployment actually has.** `dsh-base` mounts
 * `@deepseek-ai/dsh-lease-sqlite` as `lease-store`, so a stop honoured only by
 * the in-memory provider would be a stop the shipped harness does not have.
 * The obligations are the contract's shared table; this file supplies the
 * mounting and one durability question only this provider can be asked — that
 * a refused acquisition leaves nothing behind in the database.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import ControlPlaneService from '@deepseek-ai/dsh-control-plane/plugin'
import type { ControlRequest } from '@deepseek-ai/dsh-control-plane/channel'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import type { WorkerId, WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import { runStopGateConformance, UNREADABLE_PLANE_MESSAGE } from '../../../collaboration/lease-contract/tests/stop-gate-conformance.ts'
import type { MountedStore, MountedWithPlane } from '../../../collaboration/lease-contract/tests/stop-gate-conformance.ts'
import LeaseStorePlugin, { openLeaseStore } from '../src/index.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/**
 * A fresh directory, for either the leases or a stop record.
 * @param prefix - what the directory is for, so a leftover names itself.
 * @returns the directory path, removed after the case.
 */
function directory(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

const REQUEST: ControlRequest = {
  requestedBy: brandString<PrincipalId>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
}

/**
 * Mount the durable provider beside a live control plane.
 * @returns the mounted store, the two stop verbs, and the directory its leases live in.
 */
async function mountWithPlane(): Promise<MountedWithPlane & { readonly leases: string }> {
  const ctx = new Context()
  const leases = directory('lease-sqlite-stop-gate-')
  await ctx.plugin(ControlPlaneService, { storePath: directory('control-plane-stop-gate-') })
  await ctx.plugin(LeaseStorePlugin, { directory: leases })
  const store = ctx.get('leaseStore')
  const plane = ctx.get('controlPlane')
  if (store === undefined || plane === undefined) throw new Error('the mount did not publish both services')
  return {
    store,
    leases,
    stop: () => { plane.control('pause-new-actions', REQUEST) },
    release: () => { plane.control('resume', REQUEST) },
    dispose: () => ctx.fiber.dispose(),
  }
}

/**
 * Mount the durable provider where nothing publishes a control plane.
 * @returns the mounted store.
 */
async function withoutPlane(): Promise<MountedStore> {
  const ctx = new Context()
  await ctx.plugin(LeaseStorePlugin, { directory: directory('lease-sqlite-stop-gate-') })
  const store = ctx.get('leaseStore')
  if (store === undefined) throw new Error('the mount did not publish the store')
  return { store, dispose: () => ctx.fiber.dispose() }
}

/**
 * Mount the durable provider beside a control plane that cannot answer.
 *
 * A stand-in rather than the real service caught mid-mount: the real one throws
 * from `state()` until its channel is open, and winning that race would make
 * the case about timing rather than about the gate.
 * @returns the mounted store.
 */
async function withUnreadablePlane(): Promise<MountedStore> {
  const ctx = new Context()
  // The same sentence the real service throws before its channel is open, so
  // the table can match it rather than accept any throw at all.
  ctx.provide('controlPlane', {
    state: () => { throw new Error(UNREADABLE_PLANE_MESSAGE) },
  } as never)
  await ctx.plugin(LeaseStorePlugin, { directory: directory('lease-sqlite-stop-gate-') })
  const store = ctx.get('leaseStore')
  if (store === undefined) throw new Error('the mount did not publish the store')
  return { store, dispose: () => ctx.fiber.dispose() }
}

runStopGateConformance({
  name: 'the durable lease store',
  withPlane: () => mountWithPlane(),
  withoutPlane,
  withUnreadablePlane,
})

it('P2-12 must[2]: a refused acquisition leaves no row a later process could read as ownership', async () => {
  const mounted = await mountWithPlane()
  const granted = brandString<WorkItemId>('durably-granted')
  const refused = brandString<WorkItemId>('durably-refused')
  const worker = brandString<WorkerId>('worker-1')
  try {
    // Taken BEFORE the stop, and kept: it is this case's proof that the second
    // opening below reads the file this mount wrote. Without it, "the refused
    // item is not there" is equally true of a database that was never written
    // to at all — a wrong directory would pass.
    expect(mounted.store.acquire(granted, worker, 1_000, 30_000)).toMatchObject({ acquired: true })
    mounted.stop()
    expect(mounted.store.acquire(refused, worker, 1_000, 30_000)).toEqual({ acquired: false, reason: 'stopped' })
  } finally {
    await mounted.dispose()
  }
  // Read through a SECOND opening of the same database, which is what a
  // restart or a second host does: a refusal that had written a lease or
  // burned an epoch would be visible here after this mount is gone, and the
  // in-process assertions above could not see it.
  const reopened = openLeaseStore(mounted.leases)
  expect(reopened.get(granted), 'the reopened database must be the one the mount wrote').toMatchObject({ holder: worker, epoch: 0 })
  expect(reopened.get(refused)).toBeUndefined()
  // Epoch 0 again, and for the item that was refused rather than the one that
  // was granted: the high-water epoch is kept per work item, so a refusal that
  // had reached the issuer would have moved THIS item's counter to 1 while
  // leaving the granted item's at 0.
  expect(reopened.acquire(refused, worker, 2_000, 30_000)).toMatchObject({ acquired: true, token: { epoch: 0 } })
})
