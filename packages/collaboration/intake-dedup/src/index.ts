/**
 * The one deduplication rule two consumers share (Epic P4-06 must[2]).
 *
 * BLOCKED-136 measured the alternative: `dsh-message-bus` and the then-separate `dsh-mailbox`
 * had each written this rule, with the same key derivation, the same
 * caller-supplied seen-set and the same load-bearing ordering — the second
 * citing the first in prose rather than importing it. One rule with two
 * implementations can drift, and the copy P4-06's clause is about was the one
 * nothing called.
 *
 * It lives in its own package rather than in either caller because of the
 * layer direction: `collaboration` is capability-definitions and `run` is
 * orchestration-runtime, so a mailbox importing the bus would be a definition
 * depending on a runtime. Here, both edges point down or sideways.
 *
 * @module @deepseek-ai/dsh-intake-dedup
 */

export { classifyDedup, dedupKey } from './dedup.ts'
export type { DedupableMessage, DedupDecision } from './dedup.ts'
