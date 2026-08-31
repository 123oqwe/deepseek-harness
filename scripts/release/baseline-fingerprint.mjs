#!/usr/bin/env node
/**
 * P0-01 C-stage no-behavior stub for `pnpm baseline:capture` / `pnpm baseline:verify`
 * (spec/first100/exec/decisions-approved.md §B5, B4(f)). This file exists only so
 * `tests/release/baseline-fingerprint.spec.ts` fails on genuine behavioral
 * assertion mismatches today, never on `MODULE_NOT_FOUND`. It deliberately
 * implements NONE of the real capture/verify contract described in
 * `docs/audit/baseline-fingerprint-0a53fb55bea101816fa226bb964ae2bed71c343b.md`
 * and `.dsh/baseline.json`'s canonical field set — that is P0-01's P-stage,
 * a separate later GREEN slice. Do not add real logic here.
 *
 * CLI: `node scripts/release/baseline-fingerprint.mjs <capture|verify> --repo-root <path>`
 * - `capture` writes an empty, deliberately incomplete `.dsh/baseline.json`
 *   under `--repo-root` (none of the MUST-clause fields) and never writes
 *   `docs/audit/baseline-fingerprint-<sha>.md`, then exits 0.
 * - `verify` always exits 2, regardless of drift, and never writes a rebase
 *   report.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function repoRootArg(args) {
  const index = args.indexOf('--repo-root')
  if (index === -1 || index + 1 >= args.length) {
    throw new Error('baseline-fingerprint stub: --repo-root <path> is required')
  }
  return args[index + 1]
}

function capture(repoRoot) {
  const dshDir = join(repoRoot, '.dsh')
  mkdirSync(dshDir, { recursive: true })
  writeFileSync(join(dshDir, 'baseline.json'), '{}\n')
  return 0
}

function verify() {
  return 2
}

function main() {
  const [subcommand, ...rest] = process.argv.slice(2)
  const repoRoot = repoRootArg(rest)
  if (subcommand === 'capture') process.exit(capture(repoRoot))
  if (subcommand === 'verify') process.exit(verify(repoRoot))
  throw new Error(`baseline-fingerprint stub: unknown subcommand ${JSON.stringify(subcommand)}`)
}

main()
