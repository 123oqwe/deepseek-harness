/**
 * Vitest configuration for measurements (`tests/first100/measure/*.measure.ts`).
 *
 * No other configuration collects `*.measure.ts`, so a measurement runs only
 * when a narrow CI run names this file with `--config`: never in the full test
 * suite, the e2e suite or the snapshot suite. A measurement reports through the
 * JSON reporter, in each case's `duration` and `meta`.
 */

import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts'],
    include: ['tests/first100/measure/*.measure.ts'],
    // A measurement's cases share one fixture and run in order; a retry would
    // time a warm second attempt as if it were the first.
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    retry: 0,
    fileParallelism: false,
  },
})
