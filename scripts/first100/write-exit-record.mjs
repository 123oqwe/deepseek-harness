/**
 * Write the exit record an observation step of `.github/workflows/first100-exact-sha.yml` leaves beside its vitest
 * json report (BLOCKED-326 (b)).
 *
 * The record binds the step's exit code to the run and the report it belongs to: `exitCode`; `unhandledErrors`, the
 * count `unhandled-errors-reporter.ts` wrote to `$FIRST100_UNHANDLED_ERRORS_OUT`, or `null` when the run ended before
 * the reporter wrote it; `runId`, the GitHub Actions run (`$GITHUB_RUN_ID`); and `reportSha256`, the sha256 of the
 * report, or `null` when vitest wrote none. `generate-ledger.mjs` reads all four before it greens a cell.
 *
 * Usage: `node scripts/first100/write-exit-record.mjs <report.json> <record.exit.json> <exit code>`. Exits 2 without
 * writing when an argument is missing, the exit code is not a non-negative integer, `$FIRST100_UNHANDLED_ERRORS_OUT`
 * is unset, or `$GITHUB_RUN_ID` is not a run id.
 * @module scripts/first100/write-exit-record
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const [reportPath, recordPath, rawExitCode] = process.argv.slice(2)
if (reportPath === undefined || recordPath === undefined || rawExitCode === undefined || !/^\d+$/u.test(rawExitCode)) {
  console.error('usage: write-exit-record.mjs <report.json> <record.exit.json> <exit code>')
  process.exit(2)
}
const countPath = process.env.FIRST100_UNHANDLED_ERRORS_OUT
const runId = process.env.GITHUB_RUN_ID
if (countPath === undefined || countPath === '' || runId === undefined || !/^\d+$/u.test(runId)) {
  console.error('write-exit-record.mjs: FIRST100_UNHANDLED_ERRORS_OUT must name the reporter\'s count file and GITHUB_RUN_ID must be a run id')
  process.exit(2)
}

const count = existsSync(countPath) ? JSON.parse(readFileSync(countPath, 'utf8'))?.unhandledErrors : undefined
const record = {
  exitCode: Number(rawExitCode),
  unhandledErrors: Number.isInteger(count) && count >= 0 ? count : null,
  runId,
  reportSha256: existsSync(reportPath) ? createHash('sha256').update(readFileSync(reportPath)).digest('hex') : null,
}
writeFileSync(recordPath, `${JSON.stringify(record)}\n`)
