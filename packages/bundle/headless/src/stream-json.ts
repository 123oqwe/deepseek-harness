/**
 * Machine-readable output for a scriptable headless run (Epic P9-06 must[1]).
 *
 * The line format is not invented here. `apps/cli/tests/profiles/headless/tests/
 * expected/*​/stream-json.expected.jsonl` already records what a consumer reads,
 * and until now the only thing that produced those lines was a test driver — the
 * format existed as recorded output with no shipped producer. This module is
 * that producer, and it emits the recorded shape rather than a second one.
 *
 * Two envelopes, distinguished by `type`:
 *
 * - `session_event` — one durable session event, in log order.
 * - `result` — exactly one final line: the answer text and accumulated usage.
 *
 * Every line is one complete JSON object followed by a newline, so a consumer
 * can parse incrementally without buffering the run. Nothing else is written to
 * stdout in this mode; a reader that finds a non-JSON line has found a bug
 * rather than a message it should skip.
 *
 * @module @deepseek-ai/dsh-headless/stream-json
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** How a scriptable run writes its outcome to stdout. */
export type OutputFormat =
  /** The final assistant text, and nothing else. The default, unchanged. */
  | 'text'
  /** One JSON object per session event, then one `result` line. */
  | 'stream-json'
  /** Exactly one JSON object: the same `result` line, with no event stream. */
  | 'json'

/** Every accepted `--output-format` value, in the order `--help` lists them. */
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['text', 'stream-json', 'json']

/** One durable session event, as a consumer reads it. */
export interface StreamJsonEventLine {
  readonly type: 'session_event'
  /** The session the event belongs to; constant for a one-shot run. */
  readonly sessionId: string
  readonly event: SessionEvent
}

/** The final line of a machine-readable run. */
export interface StreamJsonResultLine {
  readonly type: 'result'
  readonly sessionId: string
  /** The final assistant text, identical to what `text` format prints. */
  readonly output: string
  /** Accumulated model usage; absent when the run recorded none. */
  readonly usage?: TokenUsage
}

/** Any line a machine-readable run writes. */
export type StreamJsonLine = StreamJsonEventLine | StreamJsonResultLine

/**
 * Whether `value` is an accepted `--output-format`.
 *
 * Exported so the command line can reject an unknown value with the list,
 * rather than accepting it and falling back to `text` — a run whose output
 * format silently changed is one a script parses wrongly and does not notice.
 * @param value - the raw argument.
 * @returns whether it names a format.
 */
export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value)
}

/**
 * Render one line, newline included.
 *
 * Serialization lives in one function so every line in a run is produced the
 * same way; a caller that assembled its own JSON could drift from the recorded
 * format one field at a time.
 * @param line - the envelope to write.
 * @returns the complete line, terminated by a newline.
 */
export function renderLine(line: StreamJsonLine): string {
  return `${JSON.stringify(line)}\n`
}
