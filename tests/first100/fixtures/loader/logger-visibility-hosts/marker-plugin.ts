/**
 * A plugin inserted with `--patch` into a shipped host for A-394's
 * measurement: it logs a marked warn and error through its own `ctx.logger`
 * when applied, and again {@link LATE_MS} later, and after each pair writes
 * how many logger exporters are installed to the sentinel file
 * `A394_SENTINEL` names. The later pair shows a host that installs an
 * exporter only after this plugin was applied.
 * @module tests/first100/fixtures/loader/logger-visibility-hosts/marker-plugin
 */

import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

/** The text every marked line carries. */
const MARKER = 'A394-LOGGER-MARKER'
/** How long after apply the second pair is logged. */
const LATE_MS = 1_500

/** Plugin name. */
export const name = 'a394-logger-marker'

/**
 * Log the marked pair and record the exporter count.
 * @param ctx - the plugin context.
 * @param phase - `apply` or `late`.
 */
function mark(ctx: Context, phase: 'apply' | 'late'): void {
  ctx.logger.warn(`${MARKER} (${phase}): a warn from a plugin`)
  ctx.logger.error(`${MARKER} (${phase}): an error from a plugin`)
  const sentinel = process.env.A394_SENTINEL
  if (sentinel !== undefined) writeFileSync(sentinel, `${JSON.stringify({ phase, exporters: ctx.logger.exporters.size })}\n`, { flag: 'a' })
}

/**
 * Log the pair now and once more after {@link LATE_MS}.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  mark(ctx, 'apply')
  ctx.effect(() => {
    const timer = setTimeout(() => { mark(ctx, 'late') }, LATE_MS)
    return () => { clearTimeout(timer) }
  })
}
