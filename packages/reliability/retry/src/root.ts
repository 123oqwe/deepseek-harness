/**
 * Which run a retry is charged to (Epic P4-11 must[1]).
 *
 * Pure, over a caller-supplied lookup, so this package stays free of the agent
 * and session packages: every in-scope layer already holds the agent it is
 * retrying for and can look up an id.
 */

import type { RunId } from '@deepseek-ai/dsh-principal/types'

/** What this module needs to know about one session in the delegation chain. */
export interface DelegationNode {
  /** The session that delegated to this one; absent at the root. */
  readonly parentSession?: string
  /** The Run `RunPlugin` opened for this session, absent when none did. */
  readonly runId?: RunId
}

/**
 * The run a retry from `session` is charged to: the run of the delegation
 * ROOT, not of the session that happens to be retrying.
 *
 * A Run is 1:1 with a session today (`RunPlugin` opens one per
 * `agent/session-start`), so charging "this agent's run" would give a parent
 * and each of its children an independent allowance — the stacking must[1]
 * names. Walking to the root gives one total for the whole delegation tree
 * without any layer agreeing to anything.
 *
 * A cycle cannot arise from a real delegation chain, where a child's parent is
 * always an older session. `seen` guards anyway, because this walk reads
 * durable state that a corrupt or hand-edited log could make circular, and a
 * budget lookup must not hang a retry.
 * @param session - the session retrying.
 * @param lookup - resolves a session id to its delegation node; `undefined`
 *   for a session this process cannot see.
 * @returns the root's run id, or `undefined` when no run can be resolved — for
 *   which a caller must fall back to its own limits rather than to no limit.
 */
export function chargedRun(
  session: string,
  lookup: (id: string) => DelegationNode | undefined,
): RunId | undefined {
  const seen = new Set<string>()
  let current = session
  let node = lookup(current)
  while (node !== undefined && node.parentSession !== undefined && !seen.has(current)) {
    seen.add(current)
    const parent = lookup(node.parentSession)
    // A parent this process cannot see ends the walk HERE rather than
    // discarding the chain: the furthest ancestor actually resolvable is the
    // widest total available, and returning undefined would hand the caller
    // its own per-session allowance — the defect being fixed.
    if (parent === undefined) return node.runId
    current = node.parentSession
    node = parent
  }
  return node?.runId
}
