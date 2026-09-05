/**
 * `crash-world` — the fault lane's crash-and-resume scenario (Epic P0-08).
 *
 * A run is interrupted at a seed-chosen step and resumed. The base invariant is
 * that resuming never re-applies work already committed before the crash: a
 * repeated commit is a `duplicate_side_effect`, and a resume that cannot
 * continue at all is a `recovery_success` breach. Both are invariant breaches
 * rather than quality signals, because the harness owns crash recovery.
 *
 * The crash point comes from the injected generator, so a failing trial's
 * recorded seed reproduces the same crash at the same step (must[2]).
 *
 * @module benchmarks/harness-capability/scenarios/crash-world
 */

import type { Scenario } from '../runner.ts'
import type { StandardMetric } from '../report.ts'

/** The fault lane's crash-and-resume scenario. */
export const crashWorld: Scenario = {
  name: 'crash-world',
  lane: 'fault',
  requiresRealModel: false,
  run(next) {
    const breaches: StandardMetric[] = []
    const steps = 5
    const crashAt = Math.floor(next() * steps)
    const committed: number[] = []
    for (let step = 0; step < crashAt; step += 1) committed.push(step)
    // Resume: continue from the first uncommitted step, never from zero.
    const resumeFrom = committed.length
    for (let step = resumeFrom; step < steps; step += 1) {
      if (committed.includes(step)) breaches.push('duplicate_side_effect')
      committed.push(step)
    }
    if (committed.length !== steps) breaches.push('recovery_success')
    return { taskSucceeded: breaches.length === 0, invariantBreaches: breaches }
  },
}
