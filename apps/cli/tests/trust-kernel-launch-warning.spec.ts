/**
 * Epic P0-02 acceptance[3] on a real `dsh --profile headless` launch: with the
 * insecure opt-in empty, the launch pins its Trust Kernel, passes the posture
 * check and prints no insecure-boot warning.
 *
 * The launch is the P9-03 route-echo run (`fixtures/headless-smoke.ts`'s
 * `stageProfile`, the same arguments as `headless-model-route.spec.ts`) with
 * only the opt-in changed. Exit 0 is the harness's own check: with no kernel
 * and no opt-in the launch refuses to boot, so a zero exit means the kernel
 * was pinned.
 */

import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'
import { stageProfile } from './fixtures/headless-smoke.ts'
import { runKernelPinnedDsh } from './fixtures/kernel-pinned-headless.ts'

describe('P0-02 acceptance[3] -- real dsh --profile headless launch', () => {
  it('boots with no insecure-boot warning when DSH_TRUST_KERNEL_INSECURE is empty -- the kernel is pinned, so the posture check passes silently', async () => {
    const result = await runKernelPinnedDsh(
      'p0-02-kernel-pinned',
      ['--profile', 'headless', '--model', 'p9-mock-a:model-one', 'name your route'],
      stageProfile,
    )
    expect(result.stdout).toContain('ROUTE=p9-mock-a MODEL=model-one')
    expect(result.stderr).not.toContain('booting with no Trust Kernel')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
