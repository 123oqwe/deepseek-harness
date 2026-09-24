/**
 * Measurement for Epic P0-02 acceptance[2] read literally: a factory profile
 * is a production profile, and a production profile has no insecure mode, so
 * setting `DSH_TRUST_KERNEL_INSECURE` on a factory launch must refuse to boot.
 *
 * Today the opt-in is honored on every profile (`apps/cli/src/profile-boot.ts`
 * skips creating the kernel and only warns), so all 5 titles are expected to
 * fail. The case is a reading for the part of P0-02 that makes only an
 * explicit development profile accept the opt-in; it is not frozen here.
 *
 * It uses F1's harness (`fixtures/in-process-launch.ts`) without the pin spy.
 * A refusal is judged by outcome, not by its mechanism: the launch rejects,
 * the rejection is not a failure while mounting, and no config-tree entry
 * mounted.
 */

import { describe, expect, it } from 'vitest'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { IN_PROCESS_LAUNCH_TIMEOUT_MS, useInProcessLaunch } from './fixtures/in-process-launch.ts'

const launchInProcess = useInProcessLaunch()

describe('P0-02 acceptance[2] measurement -- in-process launch of each factory profile with the insecure opt-in set', () => {
  it.each(Object.keys(PROFILE_TEMPLATES))('refuses to boot the factory %s profile in-process when DSH_TRUST_KERNEL_INSECURE is set -- a production profile has no insecure mode', async (profile) => {
    const launch = await launchInProcess(profile, '1')

    expect(launch.error).toBeInstanceOf(Error)
    expect(launch.error instanceof Error ? launch.error.message : '').not.toMatch(/plugin tree failed to load/)
    expect(launch.entryMounted).toBe(false)
  }, IN_PROCESS_LAUNCH_TIMEOUT_MS)
})
