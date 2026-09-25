/**
 * P0-04 acceptance[2] on the real repository, BLOCKED-303 closing condition
 * [2]: the whole layer check, run as `pnpm run architecture:layers` from the
 * repository root with no `--repo-root` and no `--budget-ms`, finishes within
 * its 10-second default budget.
 *
 * `beforeAll` runs the CLI once, as `tests/architecture/check-layer-deps.spec.ts`
 * runs it, but over this repository and under the default budget. The CLI
 * measures its own elapsed time from process start, prints it in its summary
 * line, and writes a `time-budget:` line to stderr when the run exceeds its
 * budget. The exit code is not read here: a violation also makes it non-zero,
 * and violations are acceptance[0] and acceptance[1]'s subject.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** Deadline for the CLI process, well above the budget it enforces. */
const CLI_TIMEOUT_MS = 120_000

/** The summary line's counts and elapsed time. */
const SUMMARY = /of (\d+) workspace package\(s\), (\d+) dependency edge\(s\),.* in (\d+\.\d{2})s\.$/mu

let run: SpawnSyncReturns<string> | undefined

beforeAll(() => {
  run = spawnSync('pnpm', ['run', 'architecture:layers'], { cwd: repoRoot, encoding: 'utf8', timeout: CLI_TIMEOUT_MS })
}, CLI_TIMEOUT_MS + 15_000)

describe('P0-04 acceptance[2] on the real repository: the whole layer check under its default budget', () => {
  it('control: the run checked the whole real workspace', () => {
    const summary = SUMMARY.exec(run?.stdout ?? '')
    expect(summary, `stdout: ${run?.stdout ?? ''}\nstderr: ${run?.stderr ?? ''}`).not.toBeNull()
    expect(Number(summary?.[1])).toBeGreaterThan(300)
    expect(Number(summary?.[2])).toBeGreaterThan(1000)
  })

  it('finishes within its 10-second budget', () => {
    const summary = SUMMARY.exec(run?.stdout ?? '')
    expect(run?.stderr ?? '').not.toContain('check-layer-deps: time-budget:')
    expect(Number(summary?.[3]), `stdout: ${run?.stdout ?? ''}`).toBeLessThanOrEqual(10)
  })
})
