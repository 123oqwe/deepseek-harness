/**
 * `research-world` — the deterministic lane's multi-step retrieval task (Epic P0-08).
 *
 * A scripted retrieval world with no external API. It differs from
 * `code-world` in what it can fail at: retrieval returns an answer whose
 * support may be incomplete, so this scenario exercises
 * `verification_precision` — claiming support that was never retrieved is a
 * task failure, not an invariant breach, because the harness permits an agent
 * to be wrong. It may not permit the agent to act on a fabricated citation,
 * which is what `external-write-world` covers.
 *
 * @module benchmarks/harness-capability/scenarios/research-world
 */

import type { Scenario } from '../runner.ts'

/** The deterministic lane's retrieval scenario. */
export const researchWorld: Scenario = {
  name: 'research-world',
  lane: 'deterministic',
  requiresRealModel: false,
  run(next) {
    const retrieved = new Set<number>()
    const documents = 2 + Math.floor(next() * 3)
    for (let step = 0; step < documents; step += 1) retrieved.add(Math.floor(next() * 5))
    const cited = Math.floor(next() * 5)
    // Citing a document the run never retrieved is an unsupported claim: a
    // failed task, with no invariant breached — being wrong is allowed.
    return { taskSucceeded: retrieved.has(cited), invariantBreaches: [] }
  },
}
