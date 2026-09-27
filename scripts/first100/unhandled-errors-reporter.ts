/**
 * A vitest reporter that writes how many errors a run reported outside any test case (BLOCKED-326 (b)).
 *
 * Vitest exits 1 on such an error while its json report can still say `success: true`, so each observation step
 * in `.github/workflows/first100-exact-sha.yml` runs this reporter and `write-exit-record.mjs` copies the count
 * into the step's exit record. The count file is `$FIRST100_UNHANDLED_ERRORS_OUT`, which the step sets; with the
 * variable unset the reporter writes nothing, and `write-exit-record.mjs` refuses to write a record.
 * @module scripts/first100/unhandled-errors-reporter
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Reporter, SerializedError, TestModule } from 'vitest/node'

/** Writes `{"unhandledErrors": <count>}` to `$FIRST100_UNHANDLED_ERRORS_OUT` when the run ends. */
export default class UnhandledErrorsReporter implements Reporter {
  /**
   * Record the count of this run's unhandled errors.
   * @param _testModules - the run's test modules; not read.
   * @param unhandledErrors - the errors vitest reported outside any test case.
   */
  onTestRunEnd(_testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>): void {
    const out = process.env.FIRST100_UNHANDLED_ERRORS_OUT
    if (out === undefined || out === '') return
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify({ unhandledErrors: unhandledErrors.length })}\n`)
  }
}
