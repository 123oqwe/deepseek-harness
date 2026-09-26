/**
 * Two edges of P6-03 acceptance[1]'s projection on the shipped composition:
 * 「forget 后主存、索引、cache、projection 在 SLA 内清除并留下合规 tombstone。」
 * A session recalls a record into a model request and the record is then
 * forgotten. The session's next model request must not carry the forgotten
 * content:
 * - after the host process restarts and the session is resumed, when its
 *   next step recalls nothing;
 * - when its next step has no query, its turn carrying only whitespace.
 *
 * `./loader/p6-03-proposal/projection-driver.ts` boots the SHIPPED headless
 * profile with the base layer's `memory` row enabled over a durable file
 * directory and its `memory-context` row enabled, and reports the scripted
 * model's requests. Each control shows that the recall reached a model
 * request before the forget, and that the later request was made in the
 * history of the session that recalled. A later request without the content
 * is therefore a reading, not an empty observation.
 * @module tests/first100/fixtures/P6-03.projection.composition
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p6-03-proposal/projection-driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p6-03-proposal/base.patch.yml', import.meta.url))
const recallOverlay = fileURLToPath(new URL('./loader/p6-03-proposal/recall.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for one driver run: `restart` runs two phase processes of at most 90 seconds each. */
const DRIVER_TIMEOUT_MS = 200_000

/** The two cases the driver runs. */
type Variant = 'restart' | 'empty-query'

/** What the phase that recalls and forgets reports. */
interface Recalled {
  /** What each step threw, keyed by step. */
  readonly thrown: Readonly<Record<string, string>>
  /** Whether a model request before the forget carried the recalled content. */
  readonly recalledBefore: boolean
}

/** What the turn after the forget reports. */
interface Later {
  /** What each step threw, keyed by step. */
  readonly thrown: Readonly<Record<string, string>>
  /** How many model requests the session's steps made in that turn. */
  readonly requestsAfter: number
  /** Whether one of them carried the forgotten content. */
  readonly carriesForgotten: boolean
  /** Whether one of them holds the first turn's task, so it was made in the recalling session's history. */
  readonly holdsFirstTask: boolean
}

/** What the driver's `P6-03-PROJECTION` line reports for one variant. */
interface Report {
  readonly before: Recalled
  readonly after: Later
}

const reports = new Map<Variant, Report>()
const failures = new Map<Variant, string>()

/**
 * Run one variant through the driver.
 * @param variant - the variant.
 */
async function run(variant: Variant): Promise<void> {
  try {
    const { stdout, stderr } = await runLoaderSmoke({
      label: `P6-03 projection, ${variant}`,
      tempDirPrefix: `p6-03-projection-${variant}-`,
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      // `runLoaderSmoke` passes these instead of `[configPath]`, so the base overlay stays first.
      binArgs: [overlay, recallOverlay, variant],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: DRIVER_TIMEOUT_MS,
    })
    const json = /P6-03-PROJECTION (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    reports.set(variant, JSON.parse(json) as Report)
  } catch (error: unknown) {
    failures.set(variant, error instanceof Error ? error.message : String(error))
  }
}

/**
 * One variant's report, or the reason there is none.
 * @param variant - the variant.
 * @returns the report.
 */
function reportOf(variant: Variant): Report {
  const report = reports.get(variant)
  if (report === undefined) throw new Error(failures.get(variant) ?? `no report for ${variant}`)
  return report
}

/**
 * The control both variants share, as one object so a failure shows every part.
 * @param report - the variant's report.
 * @returns what the control compares.
 */
function controlOf(report: Report): Record<string, unknown> {
  return {
    recalledBefore: report.before.recalledBefore,
    forgetThrew: report.before.thrown.forget ?? null,
    requestedAfter: report.after.requestsAfter > 0,
    holdsFirstTask: report.after.holdsFirstTask,
  }
}

const CONTROL = { recalledBefore: true, forgetThrew: null, requestedAfter: true, holdsFirstTask: true }

describe('P6-03 acceptance[1] projection across a host restart, on the shipped headless profile', () => {
  beforeAll(() => run('restart'), DRIVER_TIMEOUT_MS + 15_000)

  it('control: the record was recalled into a model request and forgotten before the restart, and the resumed session made a model request holding the first turn\'s task', () => {
    const report = reportOf('restart')
    expect(controlOf(report), JSON.stringify(report)).toEqual(CONTROL)
  })

  it('the resumed session\'s next model request does not carry the content forgotten before the restart', () => {
    const { after } = reportOf('restart')
    expect({ requested: after.requestsAfter > 0, carriesForgotten: after.carriesForgotten }, JSON.stringify(after))
      .toEqual({ requested: true, carriesForgotten: false })
  })
})

describe('P6-03 acceptance[1] projection on a step with no query, on the shipped headless profile', () => {
  beforeAll(() => run('empty-query'), DRIVER_TIMEOUT_MS + 15_000)

  it('control: the record was recalled into a model request and forgotten, and the step with no query made a model request holding the first turn\'s task', () => {
    const report = reportOf('empty-query')
    expect(controlOf(report), JSON.stringify(report)).toEqual(CONTROL)
  })

  it('the model request of a step with no query does not carry the forgotten content', () => {
    const { after } = reportOf('empty-query')
    expect({ requested: after.requestsAfter > 0, carriesForgotten: after.carriesForgotten }, JSON.stringify(after))
      .toEqual({ requested: true, carriesForgotten: false })
  })
})
