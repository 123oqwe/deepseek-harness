/**
 * P2-12 must[2] on the in-memory provider: no new lease while a stop is in force.
 *
 * The property itself lives in the contract's shared table, which the durable
 * provider runs too — a gate proven on one provider would say nothing about the
 * one a deployment mounts. What this file owns is how THIS provider is put
 * beside a control plane, and the one behaviour the table cannot state for
 * every provider: that the plane is read at call time rather than captured at
 * mount.
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
import InMemoryLeaseStorePlugin from '../src/plugin.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/**
 * A fresh directory for one control plane's stop record.
 * @returns the directory path, removed after the case.
 */
function storeDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lease-stop-gate-'))
  roots.push(dir)
  return dir
}

const REQUEST: ControlRequest = {
  requestedBy: brandString<PrincipalId>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
}

/**
 * Mount the provider beside a live control plane.
 * @returns the mounted store, with the two verbs a case drives the stop through.
 */
async function withPlane(): Promise<MountedWithPlane> {
  const ctx = new Context()
  await ctx.plugin(ControlPlaneService, { storePath: storeDirectory() })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  const store = ctx.get('leaseStore')
  const plane = ctx.get('controlPlane')
  if (store === undefined || plane === undefined) throw new Error('the mount did not publish both services')
  return {
    store,
    stop: () => { plane.control('pause-new-actions', REQUEST) },
    release: () => { plane.control('resume', REQUEST) },
    dispose: () => ctx.fiber.dispose(),
  }
}

/**
 * Mount the provider where nothing publishes a control plane.
 * @returns the mounted store.
 */
async function withoutPlane(): Promise<MountedStore> {
  const ctx = new Context()
  await ctx.plugin(InMemoryLeaseStorePlugin)
  const store = ctx.get('leaseStore')
  if (store === undefined) throw new Error('the mount did not publish the store')
  return { store, dispose: () => ctx.fiber.dispose() }
}

/**
 * Mount the provider beside a control plane that is there but cannot answer.
 *
 * A stand-in rather than the real service caught mid-mount: the real one throws
 * from `state()` until its channel is open, and a case that had to win a race
 * with `Service.init` to observe that would be a flaky case about timing rather
 * than a statement about the gate.
 * @returns the mounted store.
 */
async function withUnreadablePlane(): Promise<MountedStore> {
  const ctx = new Context()
  // The same sentence the real service throws before its channel is open, so
  // the table can match it rather than accept any throw at all.
  ctx.provide('controlPlane', {
    state: () => { throw new Error(UNREADABLE_PLANE_MESSAGE) },
  } as never)
  await ctx.plugin(InMemoryLeaseStorePlugin)
  const store = ctx.get('leaseStore')
  if (store === undefined) throw new Error('the mount did not publish the store')
  return { store, dispose: () => ctx.fiber.dispose() }
}

runStopGateConformance({ name: 'the in-memory lease store', withPlane, withoutPlane, withUnreadablePlane })

it('P2-12 must[2]: reads the control plane at each acquisition, not once at mount', async () => {
  const mounted = await withPlane()
  try {
    const item = brandString<WorkItemId>('read-at-call-time')
    const worker = brandString<WorkerId>('worker-1')
    // The mount happened while nothing was stopped. A provider that captured
    // the state then — or injected the plane and kept the answer — would grant
    // this, and every case above would still pass because they each mount
    // afresh.
    mounted.stop()
    expect(mounted.store.acquire(item, worker, 1_000, 30_000)).toEqual({ acquired: false, reason: 'stopped' })
    mounted.release()
    expect(mounted.store.acquire(item, worker, 2_000, 30_000)).toMatchObject({ acquired: true })
  } finally {
    await mounted.dispose()
  }
})
