/**
 * A plugin inserted with `--patch` into a shipped host for A-393's cases
 * (BLOCKED-336): it logs a marked warn and error through its own `ctx.logger`
 * when applied, again `LATE_MS` later, and once when the root agent's
 * reasoning stream delivers the delta carrying `REASONING_TRIGGER`, which
 * on headless arrives while a reasoning segment is open. After each pair it
 * appends the phase to the file `A393_SENTINEL` names.
 * @module tests/first100/fixtures/loader/logger-stderr/marker-plugin
 */

import { appendFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { LATE_MS, markedLine, type MarkerPhase, PAIR_TEXTS, REASONING_TRIGGER } from './shared.ts'

/** Plugin name. */
export const name = 'a393-logger-marker'

/**
 * Log the marked pair and record the phase.
 * @param ctx - the plugin context.
 * @param phase - when the pair is logged.
 */
function mark(ctx: Context, phase: MarkerPhase): void {
  ctx.logger.warn(markedLine(phase, PAIR_TEXTS[0]))
  ctx.logger.error(markedLine(phase, PAIR_TEXTS[1]))
  const sentinel = process.env.A393_SENTINEL
  if (sentinel !== undefined) appendFileSync(sentinel, `${phase}\n`)
}

/**
 * Log the pair now, once more after `LATE_MS`, and once inside the first
 * reasoning delta that carries the trigger.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  mark(ctx, 'apply')
  ctx.effect(() => {
    const timer = setTimeout(() => { mark(ctx, 'late') }, LATE_MS)
    return () => { clearTimeout(timer) }
  })
  let markedReasoning = false
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (markedReasoning || frame.type !== 'chunk' || frame.chunk.type !== 'reasoning-delta') return
    if (!frame.chunk.text.includes(REASONING_TRIGGER)) return
    markedReasoning = true
    mark(ctx, 'reasoning')
  })
}
