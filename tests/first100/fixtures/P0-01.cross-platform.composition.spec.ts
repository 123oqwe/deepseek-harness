/**
 * P0-01 acceptance[0] (BLOCKED-305): the SAME commit's baseline fingerprint
 * captured on Linux and on macOS is byte-for-byte identical, and both record
 * this commit's SHA. B-687 captures the macOS half on a macOS CI runner and
 * hands its path to this suite through `FIRST100_MACOS_BASELINE`; this case
 * captures the Linux half against the real checkout and compares.
 *
 * The first100 gate and narrow runs set `FIRST100_MACOS_BASELINE`
 * unconditionally, so this case always runs there; the ordinary
 * `pnpm run test` / coverage run, which does not set it, excludes this file
 * (vitest.config.ts, the same env-gated list as the platform-unsupported
 * tests). So a missing variable or missing file here is a wiring fault in a run
 * that was meant to compare — the case reds, it is NOT silently skipped.
 *
 * Green evidence, not a red first: the fingerprint is content-only and records
 * nothing machine-specific, so the two captures already match. The mutation
 * (capture writing `process.platform` into a field) makes the Linux and macOS
 * bytes differ and this case red, proving it detects a platform-dependent
 * fingerprint.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const SCRIPT = join(REPO, 'scripts/release/baseline-fingerprint.mjs')
const BASELINE = join(REPO, '.dsh/baseline.json')

/** Undo the capture's writes to the tracked checkout after each case. */
let restore: (() => void) | undefined

afterEach(() => {
  restore?.()
  restore = undefined
})

/** This checkout's HEAD, the commit both captures must record. */
function headSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()
}

describe('P0-01 acceptance[0]: the baseline fingerprint is identical on Linux and macOS for this commit', () => {
  it('a freshly captured Linux baseline byte-matches the macOS capture, and both record this commit', () => {
    const macosPath = process.env.FIRST100_MACOS_BASELINE
    // Not a skip: the gate and narrow runs set this, so an absent variable or
    // file means the macOS capture did not land for this run — a fault this
    // case must show, not pass over.
    expect(macosPath, 'FIRST100_MACOS_BASELINE must be set and name the macOS baseline').toBeTruthy()
    expect(existsSync(macosPath as string), `the macOS baseline must exist at ${String(macosPath)}`).toBe(true)

    const sha = headSha()
    const auditPath = join(REPO, 'docs/audit', `baseline-fingerprint-${sha}.md`)
    const savedBaseline = existsSync(BASELINE) ? readFileSync(BASELINE) : undefined
    const auditWasAbsent = !existsSync(auditPath)
    restore = () => {
      if (savedBaseline === undefined) rmSync(BASELINE, { force: true })
      else writeFileSync(BASELINE, savedBaseline)
      if (auditWasAbsent) rmSync(auditPath, { force: true })
    }

    // Capture the Linux half against the real checkout, so `gitSha` is this HEAD
    // and the inputs are the real workspace — the same capture the macOS job ran.
    execFileSync(process.execPath, [SCRIPT, 'capture', '--repo-root', REPO], { encoding: 'utf8' })
    const linux = readFileSync(BASELINE, 'utf8')
    const macos = readFileSync(macosPath as string, 'utf8')

    // The acceptance[0] property: identical across platforms, byte for byte.
    expect(linux, 'the Linux and macOS baselines must be byte-for-byte identical').toBe(macos)
    expect((JSON.parse(linux) as { gitSha: string }).gitSha, 'the Linux baseline records this commit').toBe(sha)
    expect((JSON.parse(macos) as { gitSha: string }).gitSha, 'the macOS baseline records this commit').toBe(sha)
  })
})
