/**
 * Durable Tool event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-tools/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { WorldId, WorldProviderId } from '@deepseek-ai/dsh-execution-world/types'

/**
 * Which ExecutionWorld a tool dispatch ran inside (Epic P3-01 acceptance[0]).
 *
 * **Deliberately NOT part of the `ActionManifest`, and that omission is what
 * makes acceptance[0] hold.** The clause requires one `ToolExecution` to move
 * between a local, container or microVM provider without changing manifest or
 * policy semantics. A manifest that named its world would produce a different
 * canonical form — and therefore a different digest and a different approval —
 * for the same action run in two places, so swapping providers would invalidate
 * every binding made against it. The world is recorded BESIDE the dispatch, for
 * the audit, where a reader can see where an action ran without the digest
 * depending on it.
 *
 * Nothing attaches this yet: P3-01's Contract stage declares it, and the Usage
 * stage is where a dispatch path supplies it. A reader must not take the type's
 * presence as evidence that any tool call records a world today.
 */
export interface ToolWorldBinding {
  /** The world the dispatch ran inside. */
  readonly world: WorldId
  /** The provider that minted it, so a swap is visible in the audit. */
  readonly provider: WorldProviderId
}

/** Payload recorded when one nested PTC mode Tool dispatch starts. */
export interface PtcDispatchStartEventData {
  rootCallId: ToolCallId
  parentCallId: ToolCallId
  subCallId: ToolCallId
  name: string
  arguments: unknown
}

/** Payload recorded when one nested PTC mode Tool dispatch settles. */
export interface PtcDispatchEventData extends PtcDispatchStartEventData {
  isError: boolean
  content: ContentBlock[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One sub-dispatch STARTING inside a `run_code` program: the parent
     * `run_code` call id, the deterministic sub-call id (`<parent>:code:<n>`,
     * numbered in submission order), and the tool `name` with its
     * JSON-normalized `arguments` — the exact value dispatched, normalized
     * BEFORE dispatch, so this append can never fail on payload shape.
     * Appended when the scheduler actually starts the call (not at
     * submission), so a start means the tool body pipeline was entered; a
     * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
     * ignores it; UIs use it for live per-sub-call running state and pair it
     * with `tool/code-dispatch` by `subCallId` (timing = the two events'
     * `time` fields).
     */
    'tool/code-dispatch-start': PtcDispatchStartEventData
    /**
     * One bridged sub-dispatch SETTLING: the pairing ids (matching the
     * `tool/code-dispatch-start` with the same `subCallId`), the tool `name`
     * with the same JSON-normalized `arguments`, and the sub-call's complete
     * model-facing outcome in `tool/result`'s own vocabulary
     * (`content` + `isError`), so UIs render a sub-call through the exact
     * code path that renders a native call. Every started sub-call settles
     * with exactly one of these (abort included: the aborted pipeline result
     * is an `isError` outcome).
     * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
     * model context; persistence and UIs get every call. Appended inside the
     * parent `run_code`'s execution (the bridge drains in-flight dispatches
     * before returning), so its execution-enclosure relation holds by
     * construction.
     */
    'tool/code-dispatch': PtcDispatchEventData
  }
}
