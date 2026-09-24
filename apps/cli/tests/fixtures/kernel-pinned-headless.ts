/**
 * Run the real `dsh` bin with the Trust Kernel insecure opt-in forced empty,
 * so the launcher creates and pins its kernel.
 *
 * `runDsh` (`headless-smoke.ts`) sets `DSH_TRUST_KERNEL_INSECURE=1` for the
 * P9-03 and P9-06 cases; Epic P0-02's cases launch the other posture on the
 * same staged profiles. The value is the empty string rather than absent
 * because `runLoaderSmoke` layers `env` over the parent environment: an empty
 * value replaces an inherited one, and `resolveTrustKernelInsecureOptIn`
 * reads empty as off.
 * @module apps/cli/tests/fixtures/kernel-pinned-headless
 */

import { join } from 'node:path'
import { runLoaderSmoke, type LoaderSmokeResult } from '@deepseek-ai/dsh-loader-smoke'
import { REPOSITORY_ROOT } from './headless-smoke.ts'

/**
 * Run the real bin once with the kernel pinned.
 * @param label - smoke label, distinct per case so temporary paths never collide.
 * @param binArgs - arguments after the bin, exactly as a user would type them.
 * @param prepare - stages the profile and any files in the isolated working directory.
 * @param inspect - reads the working directory after a zero exit, before it is removed.
 * @returns the captured streams of a run that exited 0.
 */
export async function runKernelPinnedDsh(
  label: string,
  binArgs: readonly string[],
  prepare: (cwd: string) => void,
  inspect?: (cwd: string) => void,
): Promise<LoaderSmokeResult> {
  return runLoaderSmoke({
    label,
    tempDirPrefix: `dsh-${label}-`,
    binScript: join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts'),
    configPath: '',
    binArgs: [...binArgs],
    tsconfigPath: join(REPOSITORY_ROOT, 'tsconfig.json'),
    env: { DSH_TRUST_KERNEL_INSECURE: '', DSH_TELEMETRY_DISABLED: '1' },
    prepare,
    ...inspect === undefined ? {} : { inspect },
  })
}
