/**
 * The obligation every mounted lease store owes the emergency stop (P2-12 must[2]).
 *
 * **One table, both providers.** A stop that only the in-memory store honours
 * is a stop the shipped deployment does not have: `dsh-base` mounts
 * `@deepseek-ai/dsh-lease-sqlite`, so a gate written once and tested once would
 * have been tested on the provider nobody ships. Two providers passing one
 * table is what makes this a rule of the contract rather than a habit of an
 * implementation.
 *
 * The wiring is the SUBJECT's, not this file's. A provider is mounted with its
 * own configuration, and a control plane beside it is mounted by the provider's
 * own spec: `@deepseek-ai/dsh-control-plane` depends on `@deepseek-ai/dsh-agent`,
 * which depends on this package, so importing the plane here would close a
 * dependency cycle around the contract. What lives here is the property.
 *
 * Two instruments prove "the underlying store was never asked", because the
 * contract exposes no call counter:
 *
 * - the store is marked UNAVAILABLE before the stopped acquisition. A provider
 *   that forwarded would return `'store-unavailable'` — the store's own answer,
 *   which the gate cannot invent — so `'stopped'` means the call stopped above it;
 * - no epoch is consumed. Epochs are issued only on a grant and never reused, so
 *   a first grant carrying epoch 0 after a refused attempt says the refused
 *   attempt reached no issuer.
 *
 * @module @deepseek-ai/dsh-lease-contract/tests/stop-gate-conformance
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { LeaseStoreContract, WorkerId, WorkItemId } from '../src/types.ts'

/** A provider mounted for one case, with its teardown. */
export interface MountedStore {
  /** The mounted provider, as the contract describes it. */
  readonly store: LeaseStoreContract
  /** Unmount, closing whatever the provider opened. */
  dispose(): Promise<void> | void
}

/**
 * What a control plane that cannot answer throws.
 *
 * Shared so the table can match the message instead of accepting any throw: a
 * bare `toThrow()` passes when the provider was never mounted, when the store
 * failed to open, or when the subject's own wiring is wrong — every way of
 * being broken looks like the behaviour being asserted.
 */
export const UNREADABLE_PLANE_MESSAGE = 'ControlPlaneService was reached before its mount became active'

/** A provider mounted beside a control plane the case can drive. */
export interface MountedWithPlane extends MountedStore {
  /** Put an emergency stop in force. */
  stop(): void
  /** Lift it. */
  release(): void
}

/** One provider under test, and the three compositions the table needs it in. */
export interface StopGateSubject {
  /** How the provider is named in case titles. */
  readonly name: string
  /** Mounted beside a live control plane, initially running. */
  withPlane(): Promise<MountedWithPlane>
  /** Mounted where nothing publishes a control plane, which is capability absence. */
  withoutPlane(): Promise<MountedStore>
  /**
   * Mounted beside a control plane that is present but cannot answer.
   *
   * Not the same composition as absence, and the difference is the point of the
   * case that uses it: a plane nobody mounted says nothing about work, while a
   * plane that cannot be read might be holding a stop.
   */
  withUnreadablePlane(): Promise<MountedStore>
}

const ITEM = brandString<WorkItemId>('work-item-under-stop')
const WORKER = brandString<WorkerId>('worker-under-stop')
const LEASE_MS = 30_000

/**
 * Register the stop-gate obligations for one provider.
 *
 * Called inside each provider's own spec file so a failure names the provider
 * rather than a shared suite.
 * @param subject - the provider and the compositions to mount it in.
 */
export function runStopGateConformance(subject: StopGateSubject): void {
  describe(`P2-12 must[2]: ${subject.name} refuses new leases while a stop is in force`, () => {
    it('refuses the acquisition with `stopped` rather than granting one', async () => {
      const mounted = await subject.withPlane()
      try {
        mounted.stop()
        expect(mounted.store.acquire(ITEM, WORKER, 1_000, LEASE_MS)).toEqual({ acquired: false, reason: 'stopped' })
        // Nobody holds it: the refusal is the stop's, not an ownership answer.
        expect(mounted.store.get(ITEM)).toBeUndefined()
      } finally {
        await mounted.dispose()
      }
    })

    it('does not consult the store, which would have answered `store-unavailable` first', async () => {
      const mounted = await subject.withPlane()
      try {
        mounted.store.setAvailable(false)
        // The instrument's positive control, taken first: with no stop, the
        // store's own answer is what comes back, so a later `stopped` cannot be
        // the store agreeing by coincidence.
        expect(mounted.store.acquire(ITEM, WORKER, 1_000, LEASE_MS))
          .toEqual({ acquired: false, reason: 'store-unavailable' })
        mounted.stop()
        expect(mounted.store.acquire(ITEM, WORKER, 2_000, LEASE_MS)).toEqual({ acquired: false, reason: 'stopped' })
      } finally {
        await mounted.dispose()
      }
    })

    it('consumes no epoch, so the first grant after a release is still epoch 0', async () => {
      const mounted = await subject.withPlane()
      try {
        mounted.stop()
        expect(mounted.store.acquire(ITEM, WORKER, 1_000, LEASE_MS)).toMatchObject({ acquired: false })
        mounted.release()
        const taken = mounted.store.acquire(ITEM, WORKER, 2_000, LEASE_MS)
        // An epoch issued during the stop would outlive it: a worker holding
        // epoch 0 would find the store had moved to 1 and be fenced out of work
        // the stop was never about.
        expect(taken).toMatchObject({ acquired: true, token: { epoch: 0, holder: WORKER } })
      } finally {
        await mounted.dispose()
      }
    })

    it('grants normally while no stop is in force, and the grant is the store\'s own', async () => {
      const mounted = await subject.withPlane()
      try {
        const taken = mounted.store.acquire(ITEM, WORKER, 1_000, LEASE_MS)
        expect(taken).toMatchObject({ acquired: true, lease: { holder: WORKER, expiresAtMs: 1_000 + LEASE_MS } })
        expect(mounted.store.get(ITEM)).toMatchObject({ holder: WORKER, epoch: 0 })
      } finally {
        await mounted.dispose()
      }
    })

    it('grants normally when no control plane is mounted, because absence is not a stop', async () => {
      const mounted = await subject.withoutPlane()
      try {
        expect(mounted.store.acquire(ITEM, WORKER, 1_000, LEASE_MS)).toMatchObject({ acquired: true })
      } finally {
        await mounted.dispose()
      }
    })

    it('refuses rather than granting when the mounted plane cannot answer, and says whose failure it is', async () => {
      const mounted = await subject.withUnreadablePlane()
      try {
        // Thrown, not returned: a plane that cannot say whether a stop is in
        // force is not a plane saying there is none, and the composition is
        // broken in a way a caller cannot repair by retrying. Matched against
        // the PLANE's own message, so a provider that failed to mount at all
        // cannot pass this by throwing something else.
        expect(() => mounted.store.acquire(ITEM, WORKER, 1_000, LEASE_MS)).toThrow(UNREADABLE_PLANE_MESSAGE)
      } finally {
        await mounted.dispose()
      }
    })

    it('still renews and releases a lease taken before the stop, so in-flight work keeps its item', async () => {
      const mounted = await subject.withPlane()
      try {
        const taken = mounted.store.acquire(ITEM, WORKER, 1_000, LEASE_MS)
        if (!taken.acquired) throw new Error('the lease should have been granted before the stop')
        mounted.stop()
        // Gating renewal would let this lease lapse under the stop, and the
        // item could then be taken by a second worker the moment work resumes
        // while the first is still running.
        expect(mounted.store.renew(taken.token, 2_000, LEASE_MS)).toMatchObject({ renewed: true })
        mounted.store.release(taken.token)
        expect(mounted.store.get(ITEM)).toBeUndefined()
      } finally {
        await mounted.dispose()
      }
    })
  })
}
