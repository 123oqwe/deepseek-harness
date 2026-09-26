/**
 * Texts and timings the BLOCKED-336 logger-stderr marker plugin and the spec beside it share.
 * @module tests/first100/fixtures/loader/logger-stderr/shared
 */

/** The text every line the marker plugin logs carries. */
export const LOGGER_MARKER = 'A393-LOGGER-MARKER'

/** When the marker plugin logs a pair: at apply, {@link LATE_MS} later, and inside an open reasoning segment. */
export type MarkerPhase = 'apply' | 'late' | 'reasoning'

/** How long after apply the late pair is logged. */
export const LATE_MS = 1_500

/** The two texts of one logged pair, after the marker and phase. */
export const PAIR_TEXTS = ['a warn from a plugin', 'an error from a plugin'] as const

/** The reasoning the scripted model streams on headless, in two deltas of {@link REASONING_CHUNK_SIZE} code points. */
export const REASONING_TEXT = 'A393-REASONING-FIRST. A393-REASONING-SECOND.'

/** Code points per reasoning delta, so {@link REASONING_TEXT} arrives as two. */
export const REASONING_CHUNK_SIZE = 22

/** The text of the second reasoning delta whose arrival makes the marker plugin log its reasoning pair. */
export const REASONING_TRIGGER = 'A393-REASONING-SECOND'

/**
 * One marked line as the marker plugin logs it.
 * @param phase - when the pair was logged.
 * @param text - which line of the pair.
 * @returns the line's text.
 */
export function markedLine(phase: MarkerPhase, text: typeof PAIR_TEXTS[number]): string {
  return `${LOGGER_MARKER} (${phase}): ${text}`
}
