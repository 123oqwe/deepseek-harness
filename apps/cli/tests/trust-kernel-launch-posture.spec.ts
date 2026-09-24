/**
 * Epic P0-02 acceptance[2] on the launcher: a factory profile whose Trust
 * Kernel is not pinned refuses to boot when the insecure opt-in is unset.
 *
 * `trust-kernel-posture.spec.ts` calls `enforceTrustKernelPosture` directly.
 * These cases reach it through `runProfile`, once per shipped template, with
 * the template's own composition (`fixtures/in-process-launch.ts`).
 *
 * The fault is injected: `pinTrustKernel` is replaced by a spy that pins
 * nothing, while `createTrustKernel` stays real. On the factory path no one
 * triggers this state, because `createTrustKernel` is pure and cannot fail
 * (`apps/cli/src/profile-boot.ts:575-577`), so this is the only way to reach
 * the refusal branch from a launch.
 *
 * What rules out a false pass:
 * - the refusal carries boot()'s `host preparation failed` label, so it was
 *   thrown in the prepare hook, before any config-tree entry mounted;
 * - the spy was called once with a frozen kernel, so the launch reached the
 *   pin site and did not fail earlier for another reason;
 * - the sentinel entry's marker is absent, so nothing mounted;
 * - the initialized manifest lists the template's bundles, so the composition
 *   is the factory one and not a leftover profile directory.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { IN_PROCESS_LAUNCH_TIMEOUT_MS, useInProcessLaunch } from './fixtures/in-process-launch.ts'

const pinTrustKernel = vi.hoisted(() => vi.fn())

vi.mock('@deepseek-ai/dsh-trust-kernel', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-trust-kernel')>(),
  pinTrustKernel,
}))

const launchInProcess = useInProcessLaunch()

beforeEach(() => {
  pinTrustKernel.mockClear()
})

describe('P0-02 acceptance[2] -- in-process launch of each factory profile', () => {
  it.each(Object.keys(PROFILE_TEMPLATES))('refuses to boot the factory %s profile in-process when the Trust Kernel fails to pin and DSH_TRUST_KERNEL_INSECURE is unset, before any config-tree entry mounts', async (profile) => {
    // A guard against iterating an emptied table: 5 shipped templates today.
    expect(Object.keys(PROFILE_TEMPLATES).length).toBeGreaterThanOrEqual(5)

    const launch = await launchInProcess(profile, undefined)

    expect(launch.error).toBeInstanceOf(Error)
    const message = launch.error instanceof Error ? launch.error.message : ''
    expect(message).toMatch(/host preparation failed/)
    expect(message).toMatch(/Trust Kernel not initialized -- refusing to boot/)
    expect(pinTrustKernel).toHaveBeenCalledTimes(1)
    const kernel: unknown = pinTrustKernel.mock.calls[0]?.[1]
    expect(typeof kernel).toBe('object')
    expect(kernel).not.toBeNull()
    expect(Object.isFrozen(kernel)).toBe(true)
    expect(launch.entryMounted).toBe(false)
    expect(launch.manifestBundles).toEqual(PROFILE_TEMPLATES[profile]?.bundles)
  }, IN_PROCESS_LAUNCH_TIMEOUT_MS)
})
