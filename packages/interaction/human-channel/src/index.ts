/**
 * The human-interaction channel's vocabulary and durable stop (Epic P2-12).
 *
 * The Contract stage is `./types.ts`; the Provider stage added `./store.ts`,
 * the stop record that outlives the process that requested it. The channel that
 * composes the decisions over this vocabulary is
 * `@deepseek-ai/dsh-control-plane/channel`, which is where it has to be: it
 * needs both this vocabulary and those decisions, and putting it here would
 * make the two packages import each other.
 *
 * Mounting any of it as a Cordis service, and wiring the answerers that already
 * exist, is the Usage stage. Per the delegate's ruling on this epic's second
 * open question no NEW answerer is written, and a surface with none stays fail
 * closed — which is what both existing services already do.
 * @module @deepseek-ai/dsh-human-channel
 */

export * from './types.ts'
export { openStopStore } from './store.ts'
export type { StopStore } from './store.ts'
