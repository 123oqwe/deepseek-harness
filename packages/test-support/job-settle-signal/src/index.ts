/**
 * Snapshot-corpus observer that turns background-job settlement into a
 * filesystem signal. A mock subprocess that blocks until the file appears is
 * then ordered strictly after the job reached a terminal status — an ordering
 * no file written by the producer itself can establish, because a producer
 * finishes before the registry settles the job it belongs to.
 *
 * This plugin only observes. It registers no tool, emits no session event, and
 * changes no product plugin's decision, so a fixture recorded with it mounted
 * differs from one recorded without it only by the events the pinned ordering
 * itself produces.
 * @module @deepseek-ai/dsh-job-settle-signal
 */

import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-jobs'

/** Cordis plugin name. */
export const name = 'job-settle-signal'
/** The registry whose completion notifications this observer reads. */
export const inject = ['jobs']

/** Which settlement to signal, and where. */
export interface Config {
  /**
   * Absolute path written once the awaited job settles. The file's content is
   * the settled job's id and status, so a failed barrier can be diagnosed from
   * the file alone. Required; it is optional here only because the value
   * arrives from YAML, and {@link apply} rejects its absence.
   */
  file?: string
  /**
   * Job id to wait for. Omit when the composition starts exactly one job and
   * the first settlement is the intended one.
   */
  jobId?: string
}

/**
 * Write {@link Config.file} when the awaited job settles.
 * @param ctx - plugin context carrying the `jobs` registry.
 * @param config - the settlement to signal and the path to write.
 * @throws when no path is configured, because a silent no-op would leave the
 * waiting subprocess blocked until its own timeout and report as a hang.
 */
export function apply(ctx: Context, config: Config): void {
  const file = config.file
  if (file === undefined || file.length === 0) {
    throw new Error('job-settle-signal: Config.file is required (the path a waiting subprocess polls)')
  }
  ctx.effect(() => ctx.jobs.onJobDone((snapshot) => {
    if (config.jobId !== undefined && snapshot.id !== config.jobId) return
    writeFileSync(file, `${snapshot.id} ${snapshot.status}\n`)
  }), 'job-settle-signal')
}
