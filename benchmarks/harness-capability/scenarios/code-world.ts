/**
 * `code-world` — the deterministic lane's scripted editing task (Epic P0-08).
 *
 * A scripted world with no external API: an agent applies a sequence of edits
 * drawn entirely from the injected generator. It exists to give the
 * deterministic lane a task that can genuinely fail, so that lane's success
 * rate measures something. Its base invariant is that no edit is applied twice
 * — a duplicated edit is a `duplicate_side_effect` breach, not a low score.
 *
 * @module benchmarks/harness-capability/scenarios/code-world
 */

import type { Scenario } from '../runner.ts'
import type { StandardMetric } from '../report.ts'

/** The deterministic lane's scripted editing scenario. */
export const codeWorld: Scenario = {
  name: 'code-world',
  lane: 'deterministic',
  requiresRealModel: false,
  run(next) {
    const applied = new Set<number>()
    const breaches: StandardMetric[] = []
    const edits = 3 + Math.floor(next() * 3)
    for (let step = 0; step < edits; step += 1) {
      const target = Math.floor(next() * 4)
      // A re-applied edit is a duplicated side effect, which is a base-invariant
      // breach rather than a quality signal: the harness is supposed to make
      // re-application impossible, so observing one is a failure of the harness.
      if (applied.has(target)) breaches.push('duplicate_side_effect')
      applied.add(target)
    }
    // The task succeeds when every intended edit landed distinctly.
    return { taskSucceeded: breaches.length === 0 && applied.size >= 3, invariantBreaches: breaches }
  },
}
